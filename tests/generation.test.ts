import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './fixture.js';
import { ReviewService } from '../src/server/review-service.js';
import type { AnalysisPreview } from '../src/shared/explanation.js';
function result(request: AnalysisPreview, text = 'Returns 42.') {
  return { content: { functions: request.functions.map(fn => ({ id: fn.id, name: fn.name, statements: [{ text, startLine: fn.startLine, endLine: fn.endLine, uncertainty: null }] })) } };
}
test('cancelling pending generation rejects promptly and discards late results without losing source', async () => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'main.ts'), 'export function original() { return 42; }\n');
    let finish!: () => void;
    let start!: () => void;
    const started = new Promise<void>(resolve => { start = resolve; });
    let signal: AbortSignal | undefined;
    const service = new ReviewService({ apiKey: 'test', transport: (request, options) => {
      signal = options.signal; start();
      return new Promise(resolve => { finish = () => resolve(result(request)); });
    } });
    const preview = await service.prepareAnalysis(repo.path, 'main.ts');
    const generation = service.generateExplanation(preview.id);
    await started;
    assert.equal(service.cancelGeneration(preview.id), true);
    await assert.rejects(generation, /cancelled/i);
    assert.equal(signal?.aborted, true);
    finish();
    assert.match((await service.getFile(repo.path, 'main.ts')).current!.content, /original/);
  } finally { await repo.cleanup(); }
});

test('a newer request supersedes pending work and failure waits for an explicit retry', async () => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'main.ts'), 'export function original() { return 42; }\n');
    let start!: () => void;
    const started = new Promise<void>(resolve => { start = resolve; });
    let calls = 0;
    const service = new ReviewService({ apiKey: 'test', transport: async request => {
      calls++;
      if (calls === 1) { start(); return new Promise(() => {}); }
      if (calls === 2) throw new Error('OpenRouter authentication failed. Check OPENROUTER_API_KEY.');
      return result(request);
    } });
    const first = await service.prepareAnalysis(repo.path, 'main.ts');
    const pending = service.generateExplanation(first.id);
    const rejected = assert.rejects(pending, /cancelled/i);
    await started;
    const second = await service.prepareAnalysis(repo.path, 'main.ts');
    await assert.rejects(service.generateExplanation(second.id), /authentication failed/);
    await rejected;
    assert.equal(calls, 2);
    assert.ok((await service.getFile(repo.path, 'main.ts')).current);
    assert.equal((await service.generateExplanation(second.id)).functions[0].name, 'original');
    assert.equal(calls, 3);
  } finally { await repo.cleanup(); }
});

test('reported token usage and cost are exposed while unavailable or invalid values remain unknown', async () => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'main.ts'), 'export function original() { return 42; }\n');
    let usage: unknown = { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165, cost: 0.0042 };
    const service = new ReviewService({ apiKey: 'test', transport: async request => ({ ...result(request), usage }) });
    let preview = await service.prepareAnalysis(repo.path, 'main.ts');
    assert.deepEqual((await service.generateExplanation(preview.id)).usage, { promptTokens: 120, completionTokens: 45, totalTokens: 165, cost: 0.0042 });
    preview = await service.prepareAnalysis(repo.path, 'main.ts', 'test/invalid-usage');
    usage = { prompt_tokens: -1, completion_tokens: NaN, total_tokens: '10', cost: Infinity };
    assert.deepEqual((await service.generateExplanation(preview.id)).usage, {});
    preview = await service.prepareAnalysis(repo.path, 'main.ts', 'test/missing-usage');
    usage = undefined;
    assert.deepEqual((await service.generateExplanation(preview.id)).usage, {});
    preview = await service.prepareAnalysis(repo.path, 'main.ts', 'test/zero-usage');
    usage = { prompt_tokens: 0, cost: 0 };
    assert.deepEqual((await service.generateExplanation(preview.id)).usage, { promptTokens: 0, cost: 0 });
  } finally { await repo.cleanup(); }
});
