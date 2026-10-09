import ts from 'typescript';
import type { ExplanationStatement, FileExplanation } from '../shared/explanation.js';
import type { FileComparison, FunctionComparison, StatementComparison } from '../shared/comparison.js';

function fragment(statement: ExplanationStatement, explanation: FileExplanation): string {
  const source = explanation.files.find(file => file.path === statement.reference.path && file.hash === statement.reference.sourceHash && file.version === statement.reference.version);
  return source!.content.split('\n').slice(statement.reference.startLine - 1, statement.reference.endLine).join('\n').trim();
}

/** Prefix matching is bounded: later edits must not change declarations that can be
 * hoisted/captured, and local surroundings and transmitted dependencies must match.
 * This deliberately misses safe refactors; it never claims semantic equivalence. */
function stablePrefix(old: { startLine: number; endLine: number }, current: { startLine: number; endLine: number }, before: ExplanationStatement, after: ExplanationStatement, previous: FileExplanation, next: FileExplanation): boolean {
  const a = previous.files[0].content.split('\n');
  const b = next.files[0].content.split('\n');
  if (a.slice(old.startLine - 1, before.reference.endLine).join('\n') !== b.slice(current.startLine - 1, after.reference.endLine).join('\n')) return false;
  if (a.slice(0, old.startLine - 1).join('\n') !== b.slice(0, current.startLine - 1).join('\n') || a.slice(old.endLine).join('\n') !== b.slice(current.endLine).join('\n')) return false;
  // Later function/variable declarations may affect earlier calls through hoisting
  // or closures. Conservatively decline prefix matching when any occur.
  function containsDeclaration(lines: string[], start: number, end: number) {
    const source = ts.createSourceFile('suffix.ts', lines.slice(start, end).join('\n'), ts.ScriptTarget.Latest, true);
    let found = false;
    function visit(node: ts.Node) {
      if (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) || ts.isClassDeclaration(node)) found = true;
      ts.forEachChild(node, visit);
    }
    visit(source); return found;
  }
  return !containsDeclaration(a, before.reference.endLine, old.endLine) && !containsDeclaration(b, after.reference.endLine, current.endLine);
}
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
    const sameDependencies = old && JSON.stringify(previous!.files.slice(1).map(file => [file.path, file.hash])) === JSON.stringify(current!.files.slice(1).map(file => [file.path, file.hash]));
    // A local callee/constant can change without changing the caller's own text.
    const identifiers = new Set<string>();
    const syntax = ts.createSourceFile('unit.ts', functionSource(fn, current!), ts.ScriptTarget.Latest, true);
    function collect(node: ts.Node) { if (ts.isIdentifier(node)) identifiers.add(node.text); ts.forEachChild(node, collect); }
    collect(syntax);
    const sameLocalDefinitions = !old || [...previous!.functions, ...current!.functions].every(unit => {
      if (!unit.name || unit.name === fn.name || !identifiers.has(unit.name)) return true;
      const before = previous!.functions.filter(item => item.name === unit.name && item.kind === unit.kind);
      const after = current!.functions.filter(item => item.name === unit.name && item.kind === unit.kind);
      return before.length === 1 && after.length === 1 && functionSource(before[0], previous!) === functionSource(after[0], current!);
    });
    const sameContext = sameLocalDefinitions && sameDependencies && functionSource(old!, previous!) === functionSource(fn, current!);
    for (const statement of fn.statements) {
      const exact = sameLocalDefinitions && sameDependencies ? unmatched.find(item => fragment(item, previous!) === fragment(statement, current!) && (sameContext || stablePrefix(old!, fn, item, statement, previous!, current!))) : undefined;
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
