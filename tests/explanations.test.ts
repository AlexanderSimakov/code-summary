import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './fixture.js';
import { ReviewService } from '../src/server/review-service.js';

test('preview complete named functions without transmission; explicitly generate validated linked statements', async () => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'main.ts'), 'export function saveUser(email: string) {\n  if (!email) throw new Error("Email required");\n  return email.trim();\n}\n');
    let calls = 0;
    const service = new ReviewService({ apiKey: 'test-key', transport: async request => {
      calls++;
      assert.match(request.files[0].content, /throw new Error/);
      return { content: { functions: [{ id: request.functions[0].id, name: 'saveUser', statements: [
        { text: 'Rejects an empty email.', startLine: 2, endLine: 2, uncertainty: null },
        { text: 'Returns the trimmed email.', startLine: 3, endLine: 3, uncertainty: 'Does not validate email format.' },
      ] }] } };
    } });
    await service.openRepository(repo.path);
    const preview = await service.prepareAnalysis(repo.path, 'main.ts');
    assert.equal(calls, 0);
    assert.equal(preview.files.length, 1);
    assert.equal(preview.functions[0].name, 'saveUser');
    const explanation = await service.generateExplanation(preview.id);
    assert.equal(calls, 1);
    assert.equal(explanation.functions[0].statements[1].reference.startLine, 3);
    assert.equal(explanation.functions[0].statements[1].reference.sourceHash, preview.files[0].hash);
    assert.equal(explanation.functions[0].statements[1].uncertainty, 'Does not validate email format.');
  } finally { await repo.cleanup(); }
});

test('invalid ranges and rewritten names fail without losing source; explicit retry succeeds', async () => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'main.ts'), 'export const exactName = () => 42;\n');
    let mode = 'range';
    const service = new ReviewService({ apiKey: 'test', transport: async request => ({ content: { functions: [{ id: request.functions[0].id, name: mode === 'name' ? 'renamed' : 'exactName', statements: [{ text: 'Returns 42.', startLine: 1, endLine: mode === 'range' ? 99 : 1, uncertainty: null }] }] } }) });
    const preview = await service.prepareAnalysis(repo.path, 'main.ts');
    await assert.rejects(service.generateExplanation(preview.id), /Invalid explanation/);
    mode = 'name';
    await assert.rejects(service.generateExplanation(preview.id), /Invalid explanation/);
    assert.match((await service.getFile(repo.path, 'main.ts')).current!.content, /exactName/);
    mode = 'valid';
    assert.equal((await service.generateExplanation(preview.id)).functions[0].name, 'exactName');
  } finally { await repo.cleanup(); }
});

test('deleted files explain previous source and edits after preview require a new preview', async () => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'main.ts'), 'export function oldName() { return 42; }\n');
    repo.git('add', '.'); repo.git('commit', '-qm', 'function baseline');
    const { rm } = await import('node:fs/promises');
    await rm(join(repo.path, 'main.ts'));
    const service = new ReviewService({ apiKey: 'test', transport: async request => ({ content: { functions: [{ id: request.functions[0].id, name: 'oldName', statements: [{ text: 'Returns 42.', startLine: 1, endLine: 1, uncertainty: null }] }] } }) });
    const previous = await service.prepareAnalysis(repo.path, 'main.ts');
    assert.equal((await service.generateExplanation(previous.id)).functions[0].statements[0].reference.version, 'previous');
    await writeFile(join(repo.path, 'main.ts'), 'export function oldName() { return 43; }\n');
    const current = await service.prepareAnalysis(repo.path, 'main.ts');
    await writeFile(join(repo.path, 'main.ts'), 'export function oldName() { return 44; }\n');
    await assert.rejects(service.generateExplanation(current.id), /Source changed since preview/);
  } finally { await repo.cleanup(); }
});

test('missing credentials preserve browsing and settings do not expose a credential', async () => {
  const repo = await fixture();
  try {
    const service = new ReviewService({ apiKey: '' });
    await writeFile(join(repo.path, 'main.ts'), 'export function sample() { return true; }\n');
    const preview = await service.prepareAnalysis(repo.path, 'main.ts');
    assert.deepEqual(service.getSettings(), { model: 'openai/gpt-4.1-mini', configured: false });
    await assert.rejects(service.generateExplanation(preview.id), /OPENROUTER_API_KEY/);
    assert.ok((await service.getFile(repo.path, 'main.ts')).current);
  } finally { await repo.cleanup(); }
});

test('TS/JS adapters preserve exact variable and method names and group anonymous callbacks under module behavior', async () => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'sample.jsx'), 'const arrowName = () => 1;\nclass Worker {\n  async runJob() { return 2; }\n  ["exact-method"]() { return 3; }\n}\n[1].map(value => value + 1);\n');
    const preview = await new ReviewService().prepareAnalysis(repo.path, 'sample.jsx');
    assert.deepEqual(preview.functions.map(fn => fn.name), ['arrowName', 'Worker', 'runJob', '["exact-method"]', '']);
    assert.equal(preview.functions[2].startLine, 3);
  } finally { await repo.cleanup(); }
});
