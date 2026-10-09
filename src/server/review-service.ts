import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { lstat, readFile, readlink, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { FileReview, FileStatus, RepositoryReview, ReviewFile, SourceSnapshot } from '../shared/review.js';

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
export class ReviewService {
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
