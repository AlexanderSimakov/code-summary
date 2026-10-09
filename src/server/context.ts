import ts from 'typescript';
import { dirname, posix } from 'node:path';
import type { AnalysisFile } from '../shared/explanation.js';

export const defaultContextLimitBytes = 64 * 1024;
export const maxContextLimitBytes = 2 * 1024 * 1024;

/** Conservative source-only import expansion. Never reads or executes project configuration. */
export async function collectContext(
  selected: AnalysisFile,
  candidates: Set<string>,
  load: (path: string) => Promise<AnalysisFile | null>,
  contextLimitBytes: number,
): Promise<{ files: AnalysisFile[]; contextWarnings: string[]; unavailableReason?: string }> {
  if (!Number.isSafeInteger(contextLimitBytes) || contextLimitBytes < 1 || contextLimitBytes > maxContextLimitBytes) {
    throw new Error('Context limit must be a whole number of bytes between 1 and 2097152.');
  }
  const warnings = new Set<string>();
  let used = Buffer.byteLength(selected.content);
  if (used > contextLimitBytes) return { files: [], contextWarnings: ['The selected file exceeds the context limit; no source will be transmitted.'], unavailableReason: 'Selected source exceeds the context limit. Increase the limit or choose a smaller file. Source remains available.' };
  const files: AnalysisFile[] = [selected];
  const visited = new Set([selected.path]);
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const ast = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
    const imports = new Set<string>();
    function visit(node: ts.Node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.add(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        if (node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) imports.add(node.arguments[0].text);
        else warnings.add(`Dynamic dependency in ${file.path} cannot be resolved statically.`);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    for (const specifier of imports) {
      if (!specifier.startsWith('.')) {
        warnings.add(`Dependency ${specifier} in ${file.path} is external or requires project configuration; its implementation is unavailable.`);
        continue;
      }
      const base = posix.normalize(posix.join(dirname(file.path), specifier));
      if (base === '..' || base.startsWith('../') || posix.isAbsolute(base)) {
        warnings.add(`Dependency ${specifier} in ${file.path} is outside the repository and was excluded.`);
        continue;
      }
      // TS projects commonly import .js while keeping their implementation in .ts.
      const substituted = base.replace(/\.(mjs|cjs|js|jsx)$/, (_, ext: string) => ({ mjs: '.mts', cjs: '.cts', js: '.ts', jsx: '.tsx' })[ext]!);
      const paths = [...new Set([base, substituted, ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].flatMap(ext => [`${base}${ext}`, `${base}/index${ext}`])])];
      let dependency: AnalysisFile | null = null;
      let found = false;
      for (const path of paths) {
        if (!candidates.has(path)) continue;
        found = true;
        if (visited.has(path)) { dependency = null; break; }
        visited.add(path);
        dependency = await load(path);
        if (dependency) break;
        warnings.add(`Dependency ${path} is unavailable or excluded from safe source context.`);
      }
      if (!found) warnings.add(`Dependency ${specifier} in ${file.path} could not be resolved within the repository.`);
      if (!dependency) continue;
      const bytes = Buffer.byteLength(dependency.content);
      if (used + bytes > contextLimitBytes) {
        warnings.add(`Context limit reached: omitted ${dependency.path}; behavior relying on it is uncertain.`);
        continue;
      }
      used += bytes;
      files.push(dependency);
    }
  }
  return { files, contextWarnings: [...warnings] };
}
