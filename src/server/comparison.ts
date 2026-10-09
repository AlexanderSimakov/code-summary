import type { ExplanationStatement, FileExplanation } from '../shared/explanation.js';
import type { FileComparison, FunctionComparison, StatementComparison } from '../shared/comparison.js';

function fragment(statement: ExplanationStatement, explanation: FileExplanation): string {
  const source = explanation.files.find(file => file.path === statement.reference.path && file.hash === statement.reference.sourceHash && file.version === statement.reference.version);
  return source!.content.split('\n').slice(statement.reference.startLine - 1, statement.reference.endLine).join('\n').trim();
}

/** Conservative matching: exact referenced source or exact explanatory text only. */
export function compareExplanations(previewId: string, previous: FileExplanation | null, current: FileExplanation | null): FileComparison {
  const functions: FunctionComparison[] = [];
  const available = [...(previous?.functions ?? [])];
  for (const fn of current?.functions ?? []) {
    // Ambiguous duplicate names are deliberately not guessed across different scopes.
    const candidates = available.filter(old => old.name === fn.name && old.kind === fn.kind);
    const old = candidates.length === 1 && current!.functions.filter(item => item.name === fn.name && item.kind === fn.kind).length === 1 ? candidates[0] : undefined;
    if (old) available.splice(available.indexOf(old), 1);
    const statements: StatementComparison[] = [];
    const unmatched = [...(old?.statements ?? [])];
    const functionSource = (item: { startLine: number; endLine: number }, explanation: FileExplanation) => explanation.files[0].content.split('\n').slice(item.startLine - 1, item.endLine).join('\n');
    const sameContext = old && functionSource(old, previous!) === functionSource(fn, current!) && JSON.stringify(previous!.files.slice(1).map(file => [file.path, file.hash])) === JSON.stringify(current!.files.slice(1).map(file => [file.path, file.hash]));
    for (const statement of fn.statements) {
      const exact = sameContext ? unmatched.find(item => fragment(item, previous!) === fragment(statement, current!)) : undefined;
      const sameText = unmatched.find(item => item.text === statement.text);
      const match = exact ?? sameText;
      if (match) {
        unmatched.splice(unmatched.indexOf(match), 1);
        statements.push({ change: 'unchanged', previous: match, current: { ...statement, text: match.text, uncertainty: statement.uncertainty ?? match.uncertainty } });
      } else {
        statements.push({ change: 'added', previous: null, current: statement });
      }
    }
    // Within a matched function, pair remaining changes in order as a heuristic.
    for (const statement of statements) {
      if (statement.change === 'added' && unmatched.length) {
        statement.change = 'modified'; statement.previous = unmatched.shift()!;
      }
    }
    statements.push(...unmatched.map(statement => ({ change: 'removed' as const, previous: statement, current: null })));
    functions.push({ name: fn.name, kind: fn.kind, displayName: fn.displayName, statements });
  }
  for (const fn of available) functions.push({ name: fn.name, kind: fn.kind, displayName: fn.displayName, statements: fn.statements.map(statement => ({ change: 'removed', previous: statement, current: null })) });
  const sourceChanged = previous?.files[0]?.hash !== current?.files[0]?.hash;
  const allUnchanged = functions.length > 0 && functions.every(fn => fn.statements.every(statement => statement.change === 'unchanged'));
  return { previewId, functions, previous, current, files: [...(previous?.files ?? []), ...(current?.files ?? [])],
    assessment: sourceChanged && allUnchanged ? 'Source changed; no behavior change identified' : null,
    uncertainty: 'Statement matching is heuristic; matching source fragments or model wording does not prove equivalent behavior. Modified pairs are inferred by order; inspect the source diff.',
  };
}
