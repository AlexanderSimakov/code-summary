import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './fixture.js';
import { ReviewService } from '../src/server/review-service.js';

test('preview includes complete cross-file definitions and generation transmits exactly the previewed snapshots', async () => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'main.ts'), 'import { deliver } from "./delivery.js";\nexport function saveUser() {\n  return deliver();\n}\n');
    await writeFile(join(repo.path, 'delivery.ts'), 'export function deliver() {\n  return queue("welcome-email");\n}\n');
    let calls = 0;
    let transmitted: unknown;
    const service = new ReviewService({ apiKey: 'test', transport: async request => {
      calls++;
      transmitted = request.files;
      assert.match(request.files[1].content, /queue\("welcome-email"\)/);
      return { content: { functions: request.functions.map(fn => ({ id: fn.id, name: fn.name, statements: [{ text: 'Queues a welcome email.', startLine: fn.startLine, endLine: fn.endLine, uncertainty: null }] })) } };
    } });
    const preview = await service.prepareAnalysis(repo.path, 'main.ts');
    assert.equal(calls, 0);
    assert.deepEqual(preview.files.map(file => file.path), ['main.ts', 'delivery.ts']);
    const result = await service.generateExplanation(preview.id);
    assert.deepEqual(transmitted, preview.files);
    assert.equal(result.functions[0].statements[0].text, 'Queues a welcome email.');
    await writeFile(join(repo.path, 'delivery.ts'), 'export function deliver() { return sendImmediately(); }\n');
    await assert.rejects(service.generateExplanation(preview.id), /Context changed since preview/);
    assert.equal(calls, 1);
  } finally { await repo.cleanup(); }
});

test('bounded context is explicit in preview and uncertainty; oversized selections never transmit', async () => {
  const repo = await fixture();
  try {
    const source = 'import { deliver } from "./delivery";\nimport { missing } from "./missing";\nimport external from "third-party";\nexport function saveUser() { return deliver(); }\n';
    await writeFile(join(repo.path, 'main.ts'), source);
    await writeFile(join(repo.path, 'delivery.ts'), 'export function deliver() { return "queue"; }\n');
    let calls = 0;
    const service = new ReviewService({ apiKey: 'test', transport: async request => {
      calls++;
      return { content: { functions: request.functions.map(fn => ({ id: fn.id, name: fn.name, statements: [{ text: 'Calls deliver.', startLine: fn.startLine, endLine: fn.endLine, uncertainty: null }] })) } };
    } });
    const limited = await service.prepareAnalysis(repo.path, 'main.ts', undefined, { contextLimitBytes: Buffer.byteLength(source) });
    assert.equal(limited.files.length, 1);
    assert.match(limited.contextWarnings!.join(' '), /omitted delivery.ts/);
    assert.match(limited.contextWarnings!.join(' '), /missing.*could not be resolved/);
    assert.match(limited.contextWarnings!.join(' '), /third-party.*unavailable/);
    const explanation = await service.generateExplanation(limited.id);
    assert.match(explanation.functions[0].statements[0].uncertainty!, /Context limit reached/);
    const oversized = await service.prepareAnalysis(repo.path, 'main.ts', undefined, { contextLimitBytes: 10 });
    assert.equal(oversized.files.length, 0);
    assert.match(oversized.unavailableReason!, /exceeds the context limit/);
    await assert.rejects(service.generateExplanation(oversized.id), /exceeds the context limit/);
    assert.equal(calls, 1);
    assert.ok((await service.getFile(repo.path, 'main.ts')).current);
  } finally { await repo.cleanup(); }
});

test('cross-file context excludes ignored, outside-root, symbolic links, binary and oversized dependencies', async () => {
  const repo = await fixture();
  try {
    const { symlink, mkdtemp, rm } = await import('node:fs/promises');
    const outside = await mkdtemp('/private/tmp/code-summary-context-outside-');
    try {
      await writeFile(join(outside, 'outside.ts'), 'export const secret = "outside source must not transmit";');
      await symlink(join(outside, 'outside.ts'), join(repo.path, 'linked.ts'));
      await writeFile(join(repo.path, '.gitignore'), '*.secret\nignored.ts\n');
      await writeFile(join(repo.path, 'ignored.ts'), 'export const hidden = "ignored source must not transmit";');
      await writeFile(join(repo.path, 'binary.ts'), Buffer.from([65, 0, 66]));
      await writeFile(join(repo.path, 'oversized.ts'), 'x'.repeat(2 * 1024 * 1024 + 1));
      await writeFile(join(repo.path, 'main.ts'), 'import "./linked";\nimport "./ignored";\nimport "./binary";\nimport "./oversized";\nimport "../outside";\nexport function run() { return true; }\n');
      const preview = await new ReviewService().prepareAnalysis(repo.path, 'main.ts');
      assert.deepEqual(preview.files.map(file => file.path), ['main.ts']);
      assert.match(preview.contextWarnings!.join(' '), /linked.ts.*excluded/);
      assert.match(preview.contextWarnings!.join(' '), /ignored.*could not be resolved/);
      assert.match(preview.contextWarnings!.join(' '), /binary.ts.*excluded/);
      assert.match(preview.contextWarnings!.join(' '), /oversized.ts.*excluded/);
      assert.match(preview.contextWarnings!.join(' '), /outside the repository/);
    } finally { await rm(outside, { recursive: true, force: true }); }
  } finally { await repo.cleanup(); }
});

test('baseline context stays attached to previous source even when current dependencies change', async () => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'main.ts'), 'import { deliver } from "./delivery";\nexport function run() { return deliver(); }\n');
    await writeFile(join(repo.path, 'delivery.ts'), 'export function deliver() { return "queue"; }\n');
    repo.git('add', '.'); repo.git('commit', '-qm', 'cross-file baseline');
    await writeFile(join(repo.path, 'delivery.ts'), 'export function deliver() { return "immediate"; }\n');
    const service = new ReviewService();
    const baseline = await service.prepareAnalysis(repo.path, 'main.ts', undefined, { version: 'previous' });
    const current = await service.prepareAnalysis(repo.path, 'main.ts');
    assert.ok(baseline.files.every(file => file.version === 'previous'));
    assert.match(baseline.files[1].content, /queue/);
    assert.match(current.files[1].content, /immediate/);
    assert.notEqual(baseline.files[1].hash, current.files[1].hash);
  } finally { await repo.cleanup(); }
});

test('deleted baseline symbolic-link imports are excluded rather than transmitted as definitions', async () => {
  const repo = await fixture();
  try {
    const { symlink, unlink } = await import('node:fs/promises');
    await writeFile(join(repo.path, 'main.ts'), 'import "./linked";\nexport function run() { return true; }\n');
    await symlink('main.ts', join(repo.path, 'linked.ts'));
    repo.git('add', '.'); repo.git('commit', '-qm', 'symbolic baseline');
    await unlink(join(repo.path, 'linked.ts'));
    const baseline = await new ReviewService().prepareAnalysis(repo.path, 'main.ts', undefined, { version: 'previous' });
    assert.deepEqual(baseline.files.map(file => file.path), ['main.ts']);
    assert.match(baseline.contextWarnings!.join(' '), /linked.ts.*excluded/);
  } finally { await repo.cleanup(); }
});
