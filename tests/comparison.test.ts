import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './fixture.js';
import { ReviewService } from '../src/server/review-service.js';

test('English diff previews both versions, preserves unchanged wording and links modified and removed behavior', async () => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'main.ts'), 'export function work() {\n  validate();\n  retry(3);\n  oldTask();\n}\n');
    repo.git('add', '.'); repo.git('commit', '-qm', 'function baseline');
    await writeFile(join(repo.path, 'main.ts'), 'export function work() {\n  validate();\n  retry(5);\n}\n');
    let calls = 0;
    const service = new ReviewService({ apiKey: 'test', transport: async request => {
      calls++;
      const previous = request.files[0].version === 'previous';
      return { content: { functions: [{ ...request.functions[0], startLine: undefined, endLine: undefined,
        statements: [
          { text: 'Validates input.', startLine: 2, endLine: 2, uncertainty: null },
          { text: previous ? 'Retries three times.' : 'Retries five times.', startLine: 3, endLine: 3, uncertainty: null },
          ...(previous ? [{ text: 'Runs the old task.', startLine: 4, endLine: 4, uncertainty: null }] : []),
        ],
      }].map(({ startLine, endLine, ...fn }) => fn) } };
    } });
    const preview = await service.prepareComparison(repo.path, 'main.ts');
    assert.equal(calls, 0);
    assert.deepEqual(preview.files.map(file => file.version), ['previous', 'current']);
    const result = await service.generateComparison(preview.id);
    assert.equal(calls, 2);
    const statements = result.functions[0].statements;
    assert.deepEqual(statements.map(item => item.change), ['unchanged', 'modified', 'removed']);
    assert.equal(statements[0].current!.text, 'Validates input.');
    assert.equal(statements[1].previous!.text, 'Retries three times.');
    assert.equal(statements[1].current!.reference.version, 'current');
    assert.equal(statements[2].previous!.reference.version, 'previous');
    assert.match(result.uncertainty, /heuristic/i);
  } finally { await repo.cleanup(); }
});

test('added and deleted functions and files remain source-version linked; refactor assessment keeps source diff', async () => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'main.ts'), 'export function retained() { return 42; }\nexport function removed() { return 1; }\n');
    repo.git('add', '.'); repo.git('commit', '-qm', 'baseline functions');
    await writeFile(join(repo.path, 'main.ts'), 'export function retained() { const result = 42; return result; }\nexport function added() { return 2; }\n');
    const service = new ReviewService({ apiKey: 'test', transport: async request => ({ content: { functions: request.functions.map(fn => ({ id: fn.id, name: fn.name, statements: [{ text: fn.name === 'retained' ? 'Returns 42.' : `Runs ${fn.name}.`, startLine: fn.startLine, endLine: fn.endLine, uncertainty: null }] })) } }) });
    let comparison = await service.generateComparison((await service.prepareComparison(repo.path, 'main.ts')).id);
    assert.deepEqual(comparison.functions.map(fn => [fn.name, fn.statements[0].change]), [['retained', 'unchanged'], ['added', 'added'], ['removed', 'removed']]);
    await writeFile(join(repo.path, 'main.ts'), 'export function retained() { const result = 42; return result; }\nexport function removed() { return 1; }\n');
    comparison = await service.generateComparison((await service.prepareComparison(repo.path, 'main.ts')).id);
    assert.equal(comparison.assessment, 'Source changed; no behavior change identified');
    assert.match((await service.getFile(repo.path, 'main.ts')).diff, /const result/);
    const { rm } = await import('node:fs/promises');
    await rm(join(repo.path, 'main.ts'));
    comparison = await service.generateComparison((await service.prepareComparison(repo.path, 'main.ts')).id);
    assert.ok(comparison.functions.every(fn => fn.statements[0].change === 'removed'));
    assert.equal(comparison.functions[0].statements[0].previous!.reference.version, 'previous');
    await writeFile(join(repo.path, 'new.ts'), 'export function newFile() { return 7; }\n');
    comparison = await service.generateComparison((await service.prepareComparison(repo.path, 'new.ts')).id);
    assert.equal(comparison.functions[0].statements[0].change, 'added');
    assert.equal(comparison.functions[0].statements[0].current!.reference.version, 'current');
  } finally { await repo.cleanup(); }
});

test('comparison rejects changed preview before transmitting either side', async () => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'main.ts'), 'export function value() { return 1; }\n');
    repo.git('add', '.'); repo.git('commit', '-qm', 'baseline');
    await writeFile(join(repo.path, 'main.ts'), 'export function value() { return 2; }\n');
    let calls = 0;
    const service = new ReviewService({ apiKey: 'test', transport: async () => { calls++; throw new Error('Unexpected request'); } });
    const preview = await service.prepareComparison(repo.path, 'main.ts');
    await writeFile(join(repo.path, 'main.ts'), 'export function value() { return 3; }\n');
    await assert.rejects(service.generateComparison(preview.id), /Source changed since preview/);
    assert.equal(calls, 0);
  } finally { await repo.cleanup(); }
});


test('unchanged cited lines cannot mask changed enclosing behavior or dependency behavior', async () => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'main.ts'), 'export function work() {\n  if (enabled) {\n    return helper();\n  }\n}\n');
    repo.git('add', '.'); repo.git('commit', '-qm', 'baseline');
    await writeFile(join(repo.path, 'main.ts'), 'export function work() {\n  if (!enabled) {\n    return helper();\n  }\n}\n');
    const service = new ReviewService({ apiKey: 'test', transport: async request => ({ content: { functions: request.functions.map(fn => ({ id: fn.id, name: fn.name, statements: [{ text: request.files[0].version === 'previous' ? 'Calls helper when enabled.' : 'Calls helper when disabled.', startLine: 3, endLine: 3, uncertainty: null }] })) } }) });
    const result = await service.generateComparison((await service.prepareComparison(repo.path, 'main.ts')).id);
    assert.equal(result.functions[0].statements[0].change, 'modified');
    assert.equal(result.functions[0].statements[0].current!.text, 'Calls helper when disabled.');
  } finally { await repo.cleanup(); }
});

test('rephrasing an unchanged function keeps its baseline wording despite nearby source changes', async () => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'main.ts'), 'export function stable() { return 42; }\nexport function changed() { return 1; }\n');
    repo.git('add', '.'); repo.git('commit', '-qm', 'baseline');
    await writeFile(join(repo.path, 'main.ts'), 'export function stable() { return 42; }\nexport function changed() { return 2; }\n');
    const service = new ReviewService({ apiKey: 'test', transport: async request => ({ content: { functions: request.functions.map(fn => ({ id: fn.id, name: fn.name, statements: [{ text: fn.name === 'stable' ? request.files[0].version === 'previous' ? 'Returns 42.' : 'Produces the number forty-two.' : request.files[0].version === 'previous' ? 'Returns 1.' : 'Returns 2.', startLine: fn.startLine, endLine: fn.endLine, uncertainty: null }] })) } }) });
    const result = await service.generateComparison((await service.prepareComparison(repo.path, 'main.ts')).id);
    assert.equal(result.functions[0].statements[0].change, 'unchanged');
    assert.equal(result.functions[0].statements[0].current!.text, 'Returns 42.');
  } finally { await repo.cleanup(); }
});
