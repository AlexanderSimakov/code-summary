import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { lstat, readFile, readlink, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { FileReview, FileStatus, RepositoryReview, ReviewFile, SourceSnapshot } from '../shared/review.js';

import { collectContext, defaultContextLimitBytes } from './context.js';
import { extractFunctions } from './language-adapter.js';
import { openRouterTransport, type AITransport } from './openrouter.js';
import type { AnalysisPreview, FileExplanation, ModelSettings, GenerationUsage } from '../shared/explanation.js';

const execute = promisify(execFile);
const maxSourceBytes = 2 * 1024 * 1024;
const supported = (path: string) => /\.[cm]?[jt]sx?$/.test(path);

async function git(root: string, args: string[]) {
  const { stdout } = await execute('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EXTERNAL_DIFF: '', GIT_LITERAL_PATHSPECS: '1' },
  });
  return stdout;
}
function snapshot(version: SourceSnapshot['version'], content: string): SourceSnapshot {
  return { version, content, hash: createHash('sha256').update(content).digest('hex') };
}

/** Public application seam. Reads Git objects and local files; never executes target code. */
export interface ReviewServiceOptions { apiKey?: string; model?: string; transport?: AITransport }
export class ReviewService {
  private pending = new Map<string, { previewId: string; controller: AbortController }>();
  private previews = new Map<string, AnalysisPreview>();
  private options: ReviewServiceOptions;
  constructor(options: ReviewServiceOptions = {}) { this.options = options; }
  getSettings(): ModelSettings {
    return { model: this.options.model ?? process.env.OPENROUTER_MODEL ?? 'openai/gpt-4.1-mini', configured: Boolean(this.options.apiKey ?? process.env.OPENROUTER_API_KEY) };
  }
  async prepareAnalysis(repositoryPath: string, filePath: string, model = this.getSettings().model, options: { version?: SourceSnapshot['version']; contextLimitBytes?: number } = {}): Promise<AnalysisPreview> {
    if (!model.trim() || model.length > 200) throw new Error('Choose a valid OpenRouter model.');
    const file = await this.getFile(repositoryPath, filePath);
    if (!file.supported || file.notice) throw new Error('This file is unsupported for explanations. Source remains available.');
    const source = options.version === 'previous' ? file.previous : options.version === 'current' ? file.current : file.current ?? file.previous;
    if (!source) throw new Error('No source is available for analysis.');
    const repository = await this.openRepository(file.repositoryPath);
    const contextLimitBytes = options.contextLimitBytes ?? defaultContextLimitBytes;
    const context = await collectContext({ ...source, path: filePath }, new Set(repository.files.filter(entry => entry.supported).map(entry => entry.path)), async path => {
      // Respect ignores even for tracked paths and reject any symbolic-link component.
      try {
        const ignored = await execute('git', ['-c', 'core.fsmonitor=false', 'check-ignore', '--no-index', '--', path], { cwd: file.repositoryPath });
        if (ignored.stdout.trim()) return null;
      } catch (error) { if ((error as { code?: number }).code !== 1) return null; }
      try {
        for (const part of path.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/'))) {
          if ((await lstat(resolve(file.repositoryPath, part))).isSymbolicLink()) return null;
        }
      } catch (error) { if (source.version !== 'previous' || (error as NodeJS.ErrnoException).code !== 'ENOENT') return null; }
      if (source.version === 'previous') {
        const tree = await git(file.repositoryPath, ['ls-tree', repository.head!, '--', path]);
        if (!/^100(644|755) blob /.test(tree)) return null;
      }
      try {
        const dependency = await this.getFile(file.repositoryPath, path);
        const snapshot = source.version === 'previous' ? dependency.previous : dependency.current;
        return snapshot && !dependency.notice ? { ...snapshot, path } : null;
      } catch { return null; }
    }, contextLimitBytes);
    const preview: AnalysisPreview = { id: randomUUID(), repositoryPath: file.repositoryPath, filePath, model,
      ...context, contextLimitBytes, functions: extractFunctions(filePath, source.content) };
    this.previews.set(preview.id, preview);
    // A bounded session store avoids retaining arbitrary amounts of source indefinitely.
    if (this.previews.size > 100) this.previews.delete(this.previews.keys().next().value!);
    return structuredClone(preview);
  }
  async generateExplanation(previewId: string, signal?: AbortSignal): Promise<FileExplanation> {
    const preview = this.previews.get(previewId);
    if (!preview) throw new Error('Preview expired. Prepare another preview before generation.');
    const key = `${preview.repositoryPath}\0${preview.filePath}`;
    this.pending.get(key)?.controller.abort();
    const controller = new AbortController();
    const entry = { previewId, controller };
    this.pending.set(key, entry);
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) controller.abort();
    let onAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('Generation cancelled. Provider charges may still apply.'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
    try {
      const result = await Promise.race([this.performGeneration(previewId, controller.signal), aborted]);
      if (controller.signal.aborted || this.pending.get(key) !== entry) throw new Error('Generation cancelled.');
      return result;
    } finally {
      signal?.removeEventListener('abort', cancel);
      controller.signal.removeEventListener('abort', onAbort);
      if (this.pending.get(key) === entry) this.pending.delete(key);
    }
  }
  cancelGeneration(previewId: string): boolean {
    for (const entry of this.pending.values()) {
      if (entry.previewId === previewId) { entry.controller.abort(); return true; }
    }
    return false;
  }
  private async performGeneration(previewId: string, signal: AbortSignal): Promise<FileExplanation> {
    const preview = this.previews.get(previewId);
    if (!preview) throw new Error('Preview expired. Prepare another preview before generation.');
    if (preview.unavailableReason) throw new Error(preview.unavailableReason);
    const source = preview.files[0];
    for (const transmitted of preview.files) {
      const current = await this.getFile(preview.repositoryPath, transmitted.path);
      if ((transmitted.version === 'current' ? current.current : current.previous)?.hash !== transmitted.hash) throw new Error(`${transmitted.path === preview.filePath ? 'Source' : 'Context'} changed since preview. Prepare a new preview.`);
    }
    const apiKey = this.options.apiKey ?? process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('Set OPENROUTER_API_KEY in the local server .env file, then retry.');
    if (preview.functions.length === 0) throw new Error('No named functions found in this file. Source remains available.');
    signal.throwIfAborted();
    const result = await (this.options.transport ?? openRouterTransport)(structuredClone(preview), { apiKey, signal });
    signal.throwIfAborted();
    const invalid = () => new Error('Invalid explanation or source references. Retry generation; source remains available.');
    const value = result.content as any;
    if (!value || !Array.isArray(value.functions) || value.functions.length !== preview.functions.length || Object.keys(value).some(key => key !== 'functions')) throw invalid();
    const seen = new Set<string>();
    const functions = value.functions.map((item: any) => {
      const fn = preview.functions.find(fn => fn.id === item?.id);
      if (!fn || item.name !== fn.name || seen.has(fn.id) || !Array.isArray(item.statements) || !item.statements.length || Object.keys(item).some(key => !['id', 'name', 'statements'].includes(key))) throw invalid();
      seen.add(fn.id);
      const statements = item.statements.map((statement: any) => {
        if (!statement || typeof statement.text !== 'string' || !statement.text.trim() || !(statement.uncertainty === null || typeof statement.uncertainty === 'string') || !Number.isInteger(statement.startLine) || !Number.isInteger(statement.endLine) || statement.startLine < fn.startLine || statement.endLine > fn.endLine || statement.startLine > statement.endLine || Object.keys(statement).some(key => !['text', 'startLine', 'endLine', 'uncertainty'].includes(key))) throw invalid();
        return { text: statement.text, uncertainty: [statement.uncertainty, ...(preview.contextWarnings ?? [])].filter(Boolean).join(' ') || null, reference: { path: source.path, version: source.version, sourceHash: source.hash, startLine: statement.startLine, endLine: statement.endLine } };
      });
      return { ...fn, statements };
    });
    const reported = result.usage as Record<string, unknown> | undefined;
    const usage: GenerationUsage = {};
    for (const [field, upstream] of [['promptTokens', 'prompt_tokens'], ['completionTokens', 'completion_tokens'], ['totalTokens', 'total_tokens'], ['cost', 'cost']] as const) {
      const value = reported?.[upstream];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && (field === 'cost' || Number.isInteger(value))) usage[field] = value;
    }
    return { usage, previewId, model: preview.model, functions, files: structuredClone(preview.files), contextWarnings: preview.contextWarnings };
  }

  async openRepository(repositoryPath: string): Promise<RepositoryReview> {
    let root: string;
    try {
      root = (await git(await realpath(repositoryPath), ['rev-parse', '--show-toplevel'])).trim();
    } catch {
      throw new Error('Choose an existing local Git working-tree directory.');
    }
    let head: string | null = null;
    try { head = (await git(root, ['rev-parse', '--verify', 'HEAD'])).trim(); } catch { /* An unborn repository has no baseline. */ }
    const paths = (await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).split('\0').filter(Boolean);
    const statuses = new Map<string, FileStatus>();
    if (head) {
      const parts = (await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-status', '-z', head, '--'])).split('\0');
      for (let index = 0; index + 1 < parts.length; index += 2) {
        statuses.set(parts[index + 1], parts[index] === 'D' ? 'deleted' : parts[index] === 'A' ? 'added' : 'modified');
      }
    }
    const untracked = (await git(root, ['ls-files', '-z', '--others', '--exclude-standard'])).split('\0').filter(Boolean);
    for (const path of untracked) statuses.set(path, 'added');
    if (!head) for (const path of paths) statuses.set(path, 'added');
    const files: ReviewFile[] = [...new Set([...paths, ...statuses.keys()])].sort().map(path => ({ path, status: statuses.get(path) ?? 'unchanged', supported: supported(path) }));
    return { root, head, files, changedFiles: files.filter(file => file.status !== 'unchanged') };
  }

  async getFile(repositoryPath: string, filePath: string): Promise<FileReview> {
    const repository = await this.openRepository(repositoryPath);
    const entry = repository.files.find(file => file.path === filePath);
    const absolute = resolve(repository.root, filePath);
    const within = relative(repository.root, absolute);
    if (!entry || isAbsolute(filePath) || within === '..' || within.startsWith(`..${sep}`)) throw new Error('Select a file listed in this repository.');
    let current: SourceSnapshot | null = null;
    let previous: SourceSnapshot | null = null;
    let notice: string | undefined;
    if (entry.status !== 'deleted') {
      try {
        const stat = await lstat(absolute);
        if (stat.isSymbolicLink()) {
          current = snapshot('current', await readlink(absolute));
          notice = 'Symbolic link: showing its target path without reading the target.';
        } else if (!stat.isFile()) {
          notice = 'This entry is not a regular source file.';
        } else if (stat.size > maxSourceBytes) {
          notice = 'Source exceeds the 2 MiB browsing limit.';
        } else {
          // Resolve parents as well: a tracked directory replaced by a symlink must not expose outside files.
          const actual = await realpath(absolute);
          const actualRelative = relative(repository.root, actual);
          if (actualRelative === '..' || actualRelative.startsWith(`..${sep}`)) throw new Error('Source path resolves outside the repository.');
          const bytes = await readFile(actual);
          if (bytes.includes(0)) notice = 'Binary file: source text is unavailable.';
          else current = snapshot('current', bytes.toString('utf8'));
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    if (repository.head && entry.status !== 'added') {
      try {
        const content = await git(repository.root, ['show', `${repository.head}:${filePath}`]);
        if (Buffer.byteLength(content) <= maxSourceBytes && !content.includes('\0')) previous = snapshot('previous', content);
      } catch { notice ??= 'Previous source is unavailable for this entry.'; }
    }
    let diff = '';
    if (entry.status === 'added' && current) {
      const lines = current.content.split('\n');
      if (lines.at(-1) === '') lines.pop();
      diff = `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}`).join('\n')}\n`;
      if (!current.content.endsWith('\n')) diff += '\\ No newline at end of file\n';
    } else if (repository.head && entry.status !== 'unchanged') {
      diff = await git(repository.root, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', repository.head, '--', filePath]);
    }
    return { ...entry, repositoryPath: repository.root, current, previous, diff, notice };
  }
}
