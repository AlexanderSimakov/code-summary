import ts from 'typescript';
import type { AnalysisFunction } from '../shared/explanation.js';

/** TS/JS source adapter; never loads or executes a target project's configuration. */
export function extractFunctions(path: string, content: string): AnalysisFunction[] {
  const kind = /\.tsx$/.test(path) ? ts.ScriptKind.TSX : /\.jsx$/.test(path) ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, kind);
  const functions: AnalysisFunction[] = [];
  function visit(node: ts.Node) {
    const isFunction = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isConstructorDeclaration(node);
    if (isFunction && node.body) {
      let name = 'name' in node && node.name ? node.name.getText(source) : null;
      if (!name && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent)) name = node.parent.name.getText(source);
      if (ts.isConstructorDeclaration(node)) name = 'constructor';
      // Anonymous callbacks have no source name; declaration/module coverage handles those separately.
      if (name) {
        const startLine = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        const endLine = source.getLineAndCharacterOfPosition(node.getEnd() - 1).line + 1;
        functions.push({ id: `${name}@${node.getStart(source)}`, name, startLine, endLine });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return functions;
}
