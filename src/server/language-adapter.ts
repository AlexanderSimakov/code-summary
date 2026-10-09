import ts from 'typescript';
import type { AnalysisFunction } from '../shared/explanation.js';

/** TS/JS source adapter; never loads or executes a target project's configuration. */
export function extractFunctions(path: string, content: string): AnalysisFunction[] {
  const kind = /\.tsx$/.test(path) ? ts.ScriptKind.TSX : /\.jsx$/.test(path) ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, kind);
  const functions: AnalysisFunction[] = [];
  function add(node: ts.Node, name: string, kind: AnalysisFunction['kind'], displayName?: string) {
    functions.push({ id: `${kind}:${name}@${node.getStart(source)}`, name, kind, displayName,
      startLine: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      endLine: source.getLineAndCharacterOfPosition(node.getEnd() - 1).line + 1 });
  }
  for (const statement of source.statements) {
    // Anonymous callbacks are explained by their enclosing executable statement.
    if (!ts.isFunctionDeclaration(statement) && !ts.isClassDeclaration(statement) && !ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement) && !ts.isEnumDeclaration(statement) && !ts.isVariableStatement(statement) && !ts.isEmptyStatement(statement)) {
      add(statement, '', 'module', 'Module behavior');
    }
  }
  function visit(node: ts.Node) {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      add(node, node.name?.getText(source) ?? '', 'class', node.name ? undefined : 'Anonymous class');
    } else if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      add(node, node.name.getText(source), 'type');
    } else if (ts.isEnumDeclaration(node)) {
      add(node, node.name.getText(source), 'enum');
    } else if (ts.isVariableStatement(node) && (ts.isSourceFile(node.parent) || ts.isModuleBlock(node.parent))) {
      for (const declaration of node.declarationList.declarations) {
        if (!declaration.initializer || (!ts.isArrowFunction(declaration.initializer) && !ts.isFunctionExpression(declaration.initializer) && !ts.isClassExpression(declaration.initializer))) {
          add(declaration, declaration.name.getText(source), node.declarationList.flags & ts.NodeFlags.Const ? 'constant' : 'variable');
        }
      }
    }
    const isFunction = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isConstructorDeclaration(node);
    if (isFunction && node.body) {
      let name = 'name' in node && node.name ? node.name.getText(source) : null;
      if (!name && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent)) name = node.parent.name.getText(source);
      if (ts.isConstructorDeclaration(node)) name = 'constructor';
      // Nested anonymous callbacks belong to their enclosing source unit, not a synthetic function.
      if (name) {
        add(node, name, 'function');
      } else if (ts.isFunctionDeclaration(node)) {
        add(node, '', 'anonymous', 'Anonymous function');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return functions.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
}
