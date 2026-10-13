import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from './fixture.js';
import { ReviewService } from '../src/server/review-service.js';

test('freshness checks at capacity preserve the checked approval and every other approval', async () => {
  const repo = await fixture();
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'preview-retention-cache-'));
  let requests = 0;
  try {
    await writeFile(join(repo.path, 'main.ts'), 'export function answer() { return 42; }\n');
    const review = new ReviewService({ apiKey: 'test', cacheDirectory, transport: async preview => {
      requests++;
      return { content: { functions: preview.functions.map(fn => ({ id: fn.id, name: fn.name,
        statements: [{ text: 'Returns 42.', startLine: fn.startLine, endLine: fn.endLine, uncertainty: null }],
      })) } };
    } });
    const first = await review.prepareAnalysis(repo.path, 'main.ts');
    const second = await review.prepareAnalysis(repo.path, 'main.ts');
    for (let index = 2; index < 99; index++) await review.prepareAnalysis(repo.path, 'main.ts');
    assert.deepEqual(await review.getAnalysisFreshness(first.id), { outdated: false });
    await review.prepareAnalysis(repo.path, 'main.ts');
    for (let index = 0; index < 3; index++) assert.deepEqual(await review.getAnalysisFreshness(first.id), { outdated: false });
    assert.equal((await review.generateExplanation(first.id)).previewId, first.id);
    assert.equal((await review.generateExplanation(second.id)).previewId, second.id);
    assert.equal(requests, 1, 'compatible retained snapshots reuse the explanation');
  } finally {
    await repo.cleanup();
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});

test('new approvals expire a comparison and both sides together within the shared source-snapshot budget', async () => {
  const repo = await fixture();
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'preview-retention-cache-'));
  let requests = 0;
  try {
    await writeFile(join(repo.path, 'main.ts'), 'export function answer() { return 1; }\n');
    repo.git('add', '.'); repo.git('commit', '-qm', 'comparison baseline');
    await writeFile(join(repo.path, 'main.ts'), 'export function answer() { return 2; }\n');
    const review = new ReviewService({ apiKey: 'test', cacheDirectory, transport: async preview => {
      requests++;
      return { content: { functions: preview.functions.map(fn => ({ id: fn.id, name: fn.name,
        statements: [{ text: preview.files[0].version === 'previous' ? 'Returns one.' : 'Returns two.', startLine: fn.startLine, endLine: fn.endLine, uncertainty: null }],
      })) } };
    } });
    const first = await review.prepareComparison(repo.path, 'main.ts');
    const second = await review.prepareComparison(repo.path, 'main.ts');
    for (let index = 0; index < 96; index++) await review.prepareAnalysis(repo.path, 'main.ts');
    for (let index = 0; index < 3; index++) {
      assert.deepEqual(await review.getComparisonFreshness(first.id), { outdated: false });
      assert.deepEqual(await review.getAnalysisFreshness(second.previous!.id), { outdated: false });
    }
    await review.prepareAnalysis(repo.path, 'main.ts');
    assert.deepEqual(await review.getComparisonFreshness(first.id), { outdated: true });
    await assert.rejects(review.generateComparison(first.id), /Preview expired/);
    await assert.rejects(review.generateExplanation(first.previous!.id), /Preview expired/);
    await assert.rejects(review.generateExplanation(first.current!.id), /Preview expired/);
    await assert.rejects(review.generateComparison('unknown'), /Preview expired/);
    await assert.rejects(review.generateExplanation('unknown'), /Preview expired/);
    assert.equal(requests, 0, 'expired approvals never transmit source');
    assert.equal((await review.generateComparison(second.id)).previewId, second.id);
    assert.equal(requests, 2);
  } finally {
    await repo.cleanup();
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});

test('empty comparisons consume a retention slot instead of surviving arbitrary new approvals', async () => {
  const repo = await fixture();
  let requests = 0;
  try {
    await writeFile(join(repo.path, 'main.ts'), Buffer.from([0]));
    repo.git('add', '.'); repo.git('commit', '-qm', 'binary baseline');
    await rm(join(repo.path, 'main.ts'));
    await writeFile(join(repo.path, 'new.ts'), 'export function answer() { return 42; }\n');
    const review = new ReviewService({ transport: async () => { requests++; throw new Error('Unexpected request'); } });
    const empty = await review.prepareComparison(repo.path, 'main.ts');
    assert.deepEqual(empty.files, []);
    for (let index = 0; index < 99; index++) await review.prepareAnalysis(repo.path, 'new.ts');
    assert.equal((await review.generateComparison(empty.id)).previewId, empty.id);
    await review.prepareAnalysis(repo.path, 'new.ts');
    await assert.rejects(review.generateComparison(empty.id), /Preview expired/);
    assert.equal(requests, 0);
  } finally { await repo.cleanup(); }
});

test('added and deleted comparison previews reject a newly present source version before transmission', async () => {
  const repo = await fixture();
  let requests = 0;
  try {
    const review = new ReviewService({ apiKey: 'test', transport: async () => { requests++; throw new Error('Unexpected request'); } });
    await writeFile(join(repo.path, 'new.ts'), 'export function answer() { return 42; }\n');
    const added = await review.prepareComparison(repo.path, 'new.ts');
    assert.equal(added.previous, null);
    repo.git('add', '.'); repo.git('commit', '-qm', 'added baseline');
    assert.deepEqual(await review.getComparisonFreshness(added.id), { outdated: true });
    await assert.rejects(review.generateComparison(added.id), /Source changed since preview/);
    await rm(join(repo.path, 'new.ts'));
    const deleted = await review.prepareComparison(repo.path, 'new.ts');
    assert.equal(deleted.current, null);
    await writeFile(join(repo.path, 'new.ts'), 'export function answer() { return 42; }\n');
    assert.deepEqual(await review.getComparisonFreshness(deleted.id), { outdated: true });
    await assert.rejects(review.generateComparison(deleted.id), /Source changed since preview/);
    assert.equal(requests, 0);
  } finally { await repo.cleanup(); }
});

test('an accepted in-flight comparison keeps both approved sides when new previews expire its approval', async () => {
  const repo = await fixture();
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'preview-retention-cache-'));
  let requests = 0;
  let release!: () => void;
  let begin!: () => void;
  const started = new Promise<void>(resolve => { begin = resolve; });
  try {
    await writeFile(join(repo.path, 'main.ts'), 'export function answer() { return 1; }\n');
    repo.git('add', '.'); repo.git('commit', '-qm', 'baseline');
    await writeFile(join(repo.path, 'main.ts'), 'export function answer() { return 2; }\n');
    const review = new ReviewService({ apiKey: 'test', cacheDirectory, transport: async preview => {
      requests++;
      if (requests === 1) { begin(); await new Promise<void>(resolve => { release = resolve; }); }
      return { content: { functions: preview.functions.map(fn => ({ id: fn.id, name: fn.name,
        statements: [{ text: 'Returns the approved number.', startLine: fn.startLine, endLine: fn.endLine, uncertainty: null }],
      })) } };
    } });
    const preview = await review.prepareComparison(repo.path, 'main.ts');
    const pending = review.generateComparison(preview.id);
    await started;
    for (let index = 0; index < 100; index++) await review.prepareAnalysis(repo.path, 'main.ts');
    await assert.rejects(review.generateComparison(preview.id), /Preview expired/);
    release();
    const comparison = await pending;
    assert.equal(comparison.previous!.files[0].hash, preview.previous!.files[0].hash);
    assert.equal(comparison.current!.files[0].hash, preview.current!.files[0].hash);
    assert.equal(requests, 2);
  } finally {
    release?.();
    await repo.cleanup();
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});
