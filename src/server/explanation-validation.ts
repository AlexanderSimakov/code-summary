import type { AnalysisPreview } from '../shared/explanation.js';

/** Shared source-unit and statement validation after provider/cache envelope decoding. */
export function validExplanationFunctions(preview: AnalysisPreview, functions: unknown): boolean {
  if (!Array.isArray(functions) || functions.length !== preview.functions.length) return false;
  const seen = new Set<string>();
  const source = preview.files[0];
  for (const fn of functions) {
    const unit = preview.functions.find(unit => unit.id === fn?.id);
    if (!unit || fn.name !== unit.name || fn.kind !== unit.kind || fn.startLine !== unit.startLine || fn.endLine !== unit.endLine || seen.has(fn.id) || !Array.isArray(fn.statements) || !fn.statements.length) return false;
    seen.add(fn.id);
    for (const statement of fn.statements) {
      const reference = statement?.reference;
      if (!statement || typeof statement.text !== 'string' || !statement.text.trim() || !(statement.uncertainty === null || typeof statement.uncertainty === 'string') || !reference || reference.path !== preview.filePath || reference.sourceHash !== source?.hash || reference.version !== source?.version || !Number.isInteger(reference.startLine) || !Number.isInteger(reference.endLine) || reference.startLine < unit.startLine || reference.endLine > unit.endLine || reference.startLine > reference.endLine) return false;
      if (!/[^\s{}()[\];,]/.test(source.content.split('\n').slice(reference.startLine - 1, reference.endLine).join('\n'))) return false;
    }
  }
  return true;
}
