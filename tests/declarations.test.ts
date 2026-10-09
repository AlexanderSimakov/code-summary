import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './fixture.js';
import { ReviewService } from '../src/server/review-service.js';

test('module initialization and side-effect imports produce source-linked explanations without invented names', async () => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'init.js'), 'import "./register.js";\n[1, 2].forEach(value => console.log(value));\n');
    const service = new ReviewService({ apiKey: 'test', transport: async request => ({ content: { functions: request.functions.map(unit => ({ id: unit.id, name: unit.name, statements: [{ text: unit.startLine === 1 ? 'Loads registration for its side effects.' : 'Logs each value.', startLine: unit.startLine, endLine: unit.endLine, uncertainty: null }] })) } }) });
    const preview = await service.prepareAnalysis(repo.path, 'init.js');
    assert.equal(preview.functions.length, 2);
    assert.deepEqual(preview.functions.map(unit => unit.name), ['', '']);
    const result = await service.generateExplanation(preview.id);
    assert.deepEqual(result.functions.map(unit => unit.statements[0].reference.startLine), [1, 2]);
    assert.ok(result.functions.every(unit => unit.statements[0].reference.version === 'current'));
  } finally { await repo.cleanup(); }
});

test('classes, types, constants and enums appear in English comparisons with exact identifiers and both source versions', async () => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'main.ts'), 'export type User = { name: string };\nexport const limit = 3;\nexport class Worker {\n  count = 1;\n  runJob() { return this.count; }\n}\nexport enum Mode { Active }\n');
    repo.git('add', '.'); repo.git('commit', '-qm', 'declarations');
    await writeFile(join(repo.path, 'main.ts'), 'export interface User { name: string; active: boolean }\nexport const limit = 5;\nexport class Worker {\n  count = 2;\n  runJob() { return this.count; }\n}\nexport enum Mode { Active, Paused }\n');
    const service = new ReviewService({ apiKey: 'test', transport: async request => ({ content: { functions: request.functions.map(unit => ({ id: unit.id, name: unit.name, statements: [{ text: `${unit.name} from ${request.files[0].version}.`, startLine: unit.startLine, endLine: unit.endLine, uncertainty: null }] })) } }) });
    const preview = await service.prepareComparison(repo.path, 'main.ts');
    assert.deepEqual(preview.current!.functions.map(unit => unit.name), ['User', 'limit', 'Worker', 'runJob', 'Mode']);
    assert.deepEqual(preview.current!.functions.map(unit => unit.kind), ['type', 'constant', 'class', 'function', 'enum']);
    const comparison = await service.generateComparison(preview.id);
    const limit = comparison.functions.find(unit => unit.name === 'limit')!;
    assert.equal(limit.statements[0].change, 'modified');
    assert.equal(limit.statements[0].previous!.reference.version, 'previous');
    assert.equal(limit.statements[0].current!.reference.startLine, 2);
    assert.ok(comparison.functions.some(unit => unit.name === 'Worker'));
  } finally { await repo.cleanup(); }
});

test('anonymous default functions preserve an empty source name and accessors preserve written names', async () => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'anonymous.ts'), 'export default function () { return 42; }\nclass Store {\n  constructor() {}\n  get value() { return 1; }\n  set value(next: number) {}\n}\n');
    const service = new ReviewService({ apiKey: 'test', transport: async request => ({ content: { functions: request.functions.map(unit => ({ id: unit.id, name: unit.name, statements: [{ text: 'Describes the source behavior.', startLine: unit.startLine, endLine: unit.endLine, uncertainty: null }] })) } }) });
    const preview = await service.prepareAnalysis(repo.path, 'anonymous.ts');
    assert.deepEqual(preview.functions.map(unit => unit.name), ['', 'Store', 'constructor', 'value', 'value']);
    assert.equal(preview.functions[0].displayName, 'Anonymous function');
    const explanation = await service.generateExplanation(preview.id);
    assert.equal(explanation.functions[0].statements[0].reference.startLine, 1);
    await writeFile(join(repo.path, 'script.py'), 'print(42)\n');
    assert.equal((await service.getFile(repo.path, 'script.py')).supported, false);
    await assert.rejects(service.prepareAnalysis(repo.path, 'script.py'), /unsupported/);
    assert.equal((await service.getFile(repo.path, 'script.py')).current!.content, 'print(42)\n');
  } finally { await repo.cleanup(); }
});

test('added and deleted declarations and anonymous module behavior retain their source versions', async () => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'main.ts'), 'export type Removed = string;\nconsole.log("old");\n');
    repo.git('add', '.'); repo.git('commit', '-qm', 'baseline declaration');
    await writeFile(join(repo.path, 'main.ts'), 'export type Added = number;\nconsole.log("new");\n');
    const service = new ReviewService({ apiKey: 'test', transport: async request => ({ content: { functions: request.functions.map(unit => ({ id: unit.id, name: unit.name, statements: [{ text: `${unit.name || 'Module behavior'} ${request.files[0].version}.`, startLine: unit.startLine, endLine: unit.endLine, uncertainty: null }] })) } }) });
    const comparison = await service.generateComparison((await service.prepareComparison(repo.path, 'main.ts')).id);
    assert.equal(comparison.functions.find(unit => unit.name === 'Added')!.statements[0].change, 'added');
    assert.equal(comparison.functions.find(unit => unit.name === 'Removed')!.statements[0].change, 'removed');
    const module = comparison.functions.find(unit => unit.name === '')!;
    assert.equal(module.displayName, 'Module behavior');
    assert.equal(module.statements[0].previous!.reference.version, 'previous');
    assert.equal(module.statements[0].current!.reference.version, 'current');
  } finally { await repo.cleanup(); }
});
