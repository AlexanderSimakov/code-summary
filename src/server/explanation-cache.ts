import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AnalysisPreview, FileExplanation } from '../shared/explanation.js';

// Bump when parser, prompt, output schema or context selection behavior changes.
const generationRevision = 'ts5.9-source-units-v2-context-v1-prompt-v4-schema-v2-uncertainty-v2';
export function analysisIdentity(preview: AnalysisPreview): string {
  return createHash('sha256').update(JSON.stringify({ generationRevision,
    repository: preview.repositoryPath, path: preview.filePath, model: preview.model,
    contextLimitBytes: preview.contextLimitBytes, files: preview.files, functions: preview.functions,
    warnings: preview.contextWarnings, unavailable: preview.unavailableReason,
  })).digest('hex');
}
export class ExplanationCache {
  constructor(private directory = process.env.CODE_SUMMARY_CACHE_DIR ?? join(tmpdir(), `code-summary-${process.getuid?.() ?? 'local'}-cache`)) {}
  async get(preview: AnalysisPreview): Promise<FileExplanation | null> {
    try {
      const saved = JSON.parse(await readFile(join(this.directory, `${analysisIdentity(preview)}.json`), 'utf8'));
      if (saved.identity !== analysisIdentity(preview) || !Array.isArray(saved.result?.functions) || !Array.isArray(saved.result?.files)) return null;
      const result = saved.result as FileExplanation;
      if (result.model !== preview.model || JSON.stringify(result.files) !== JSON.stringify(preview.files) || result.functions.length !== preview.functions.length) return null;
      const seen = new Set<string>();
      for (const fn of result.functions) {
        const unit = preview.functions.find(unit => unit.id === fn?.id);
        if (!unit || fn.name !== unit.name || seen.has(fn.id) || !Array.isArray(fn.statements) || !fn.statements.length) return null;
        seen.add(fn.id);
        for (const statement of fn.statements) {
          const reference = statement?.reference;
          if (!statement || typeof statement.text !== 'string' || !statement.text.trim() || !(statement.uncertainty === null || typeof statement.uncertainty === 'string') || !reference || reference.path !== preview.filePath || reference.sourceHash !== preview.files[0]?.hash || reference.version !== preview.files[0]?.version || !Number.isInteger(reference.startLine) || !Number.isInteger(reference.endLine) || reference.startLine < unit.startLine || reference.endLine > unit.endLine || reference.startLine > reference.endLine) return null;
        }
      }
      return { ...result, previewId: preview.id, cached: true };
    } catch { return null; }
  }
  async put(preview: AnalysisPreview, result: FileExplanation): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const identity = analysisIdentity(preview);
    const temporary = join(this.directory, `${identity}.${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify({ identity, result }), { mode: 0o600 });
    await rename(temporary, join(this.directory, `${identity}.json`));
  }
}
