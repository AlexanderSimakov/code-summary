import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture } from './fixture.js';
import { ReviewService } from '../src/server/review-service.js';

test('compatible explanations survive reopening and service restart without another provider request', async () => {
  const repo = await fixture(); const cacheDirectory = await mkdtemp(join(tmpdir(), 'explanation-cache-'));
  let requests = 0;
  const options = { cacheDirectory, apiKey: 'test', transport: async (preview: any) => {
    requests++;
    return { content: { functions: preview.functions.map((fn: any) => ({ id: fn.id, name: fn.name, statements: [{ text: 'Returns 42.', startLine: fn.startLine, endLine: fn.endLine, uncertainty: null }] })) } };
  } };
  try {
    await writeFile(join(repo.path, 'sample.ts'), 'export function originalName() { return 42; }\n');
    let service = new ReviewService(options);
    let preview = await service.prepareAnalysis(repo.path, 'sample.ts');
    await service.generateExplanation(preview.id);
    service = new ReviewService(options);
    preview = await service.prepareAnalysis(repo.path, 'sample.ts');
    const result = await service.generateExplanation(preview.id);
    assert.equal(result.cached, true);
    assert.equal(requests, 1);
    assert.equal(result.functions[0].statements[0].text, 'Returns 42.');
    const different = await service.prepareAnalysis(repo.path, 'sample.ts', 'another/model');
    await service.generateExplanation(different.id);
    assert.equal(requests, 2);
  } finally { await repo.cleanup(); await rm(cacheDirectory, { recursive: true, force: true }); }
});

test('dependency edits and newly resolved imports mark retained explanations outdated and require a new preview', async () => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'main.ts'), 'import { value } from "./dependency";\nexport function read() { return value; }\n');
    const service = new ReviewService();
    const unresolved = await service.prepareAnalysis(repo.path, 'main.ts');
    assert.deepEqual(await service.getAnalysisFreshness(unresolved.id), { outdated: false });
    await writeFile(join(repo.path, 'dependency.ts'), 'export const value = 42;\n');
    assert.deepEqual(await service.getAnalysisFreshness(unresolved.id), { outdated: true });
    assert.equal(unresolved.files.length, 1);
    await assert.rejects(service.generateExplanation(unresolved.id), /Context changed since preview/);
    const resolved = await service.prepareAnalysis(repo.path, 'main.ts');
    assert.equal(resolved.files.length, 2);
    await writeFile(join(repo.path, 'dependency.ts'), 'export const value = 99;\n');
    assert.deepEqual(await service.getAnalysisFreshness(resolved.id), { outdated: true });
    assert.match(resolved.files[1].content, /42/);
  } finally { await repo.cleanup(); }
});

test('source and context limit changes miss cache while an in-flight result stays attached to its approved snapshot', async () => {
  const repo = await fixture(); const cacheDirectory = await mkdtemp(join(tmpdir(), 'explanation-cache-'));
  try {
    await writeFile(join(repo.path, 'main.ts'), 'export function read() { return 42; }\n');
    let requests = 0; let finish!: () => void; let started!: () => void;
    const beginning = new Promise<void>(resolve => { started = resolve; });
    const service = new ReviewService({ apiKey: 'test', cacheDirectory, transport: async request => {
      requests++;
      if (requests === 1) { started(); await new Promise<void>(resolve => { finish = resolve; }); }
      return { content: { functions: request.functions.map(fn => ({ id: fn.id, name: fn.name, statements: [{ text: 'Describes the approved source.', startLine: fn.startLine, endLine: fn.endLine, uncertainty: null }] })) } };
    } });
    const old = await service.prepareAnalysis(repo.path, 'main.ts');
    const pending = service.generateExplanation(old.id); await beginning;
    await writeFile(join(repo.path, 'main.ts'), 'export function read() { return 99; }\n');
    finish();
    const retained = await pending;
    assert.match(retained.files[0].content, /42/);
    assert.equal((await service.getAnalysisFreshness(retained.previewId)).outdated, true);
    assert.equal((await service.getCachedAnalysis(repo.path, 'main.ts')).explanation, null);
    const current = await service.prepareAnalysis(repo.path, 'main.ts');
    await service.generateExplanation(current.id);
    const limited = await service.prepareAnalysis(repo.path, 'main.ts', undefined, { contextLimitBytes: 1000 });
    await service.generateExplanation(limited.id);
    assert.equal(requests, 3);
  } finally { await repo.cleanup(); await rm(cacheDirectory, { recursive: true, force: true }); }
});


test('tampered cached punctuation-only references are rejected before showing an explanation', async () => {
  const repo = await fixture(); const cacheDirectory = await mkdtemp(join(tmpdir(), 'explanation-cache-'));
  let requests = 0;
  const options = { cacheDirectory, apiKey: 'test', transport: async (preview: any) => {
    requests++;
    return { content: { functions: preview.functions.map((fn: any) => ({ id: fn.id, name: fn.name, statements: [{ text: 'Returns 42.', startLine: 2, endLine: 2, uncertainty: null }] })) } };
  } };
  try {
    await writeFile(join(repo.path, 'sample.ts'), 'export function sample() {\n  return 42;\n}\n');
    const service = new ReviewService(options);
    await service.generateExplanation((await service.prepareAnalysis(repo.path, 'sample.ts')).id);
    const savedPath = join(cacheDirectory, (await readdir(cacheDirectory))[0]);
    const saved = JSON.parse(await readFile(savedPath, 'utf8'));
    saved.result.functions[0].statements[0].reference.startLine = 3;
    saved.result.functions[0].statements[0].reference.endLine = 3;
    await writeFile(savedPath, JSON.stringify(saved));
    const restarted = new ReviewService(options);
    assert.equal((await restarted.getCachedAnalysis(repo.path, 'sample.ts')).explanation, null);
    await restarted.generateExplanation((await restarted.prepareAnalysis(repo.path, 'sample.ts')).id);
    assert.equal(requests, 2);
  } finally { await repo.cleanup(); await rm(cacheDirectory, { recursive: true, force: true }); }
});
