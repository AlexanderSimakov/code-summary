import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ReviewService } from '../src/server/review-service.js';

import { fixture } from './fixture.js';

test('open a clean repository and browse unchanged source against HEAD', async () => {
  const repo = await fixture();
  try {
    const service = new ReviewService();
    const review = await service.openRepository(repo.path);
    assert.equal(review.root, repo.path);
    assert.equal(review.changedFiles.length, 0);
    assert.ok(review.files.some(file => file.path === 'main.ts' && file.status === 'unchanged'));
    const file = await service.getFile(repo.path, 'main.ts');
    assert.equal(file.current?.content, 'export const answer = 42;\n');
    assert.equal(file.previous?.content, file.current?.content);
    assert.equal(file.diff, '');
  } finally { await repo.cleanup(); }
});

test('review combines staged and unstaged edits, additions and deletions without touching target Git state', async () => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'gone.ts'), 'export function gone() {}\n');
    repo.git('add', '.'); repo.git('commit', '-qm', 'second baseline');
    await writeFile(join(repo.path, 'main.ts'), 'export const answer = 43;\n');
    repo.git('add', 'main.ts');
    await writeFile(join(repo.path, 'main.ts'), 'export const answer = 44;\n');
    await writeFile(join(repo.path, 'new file.ts'), 'export function added() {}\n');
    await writeFile(join(repo.path, 'password.secret'), 'do not read');
    await rm(join(repo.path, 'gone.ts'));
    const beforeStatus = repo.git('status', '--porcelain=v1');
    const beforeIndex = repo.git('diff', '--cached', '--no-ext-diff');
    const service = new ReviewService();
    const review = await service.openRepository(repo.path);
    assert.deepEqual(review.changedFiles.map(({ path, status }) => [path, status]), [
      ['gone.ts', 'deleted'], ['main.ts', 'modified'], ['new file.ts', 'added'],
    ]);
    const changed = await service.getFile(repo.path, 'main.ts');
    assert.equal(changed.current?.content, 'export const answer = 44;\n');
    assert.match(changed.diff, /-export const answer = 42;/);
    assert.match(changed.diff, /\+export const answer = 44;/);
    const deleted = await service.getFile(repo.path, 'gone.ts');
    assert.equal(deleted.current, null);
    assert.equal(deleted.previous?.content, 'export function gone() {}\n');
    const added = await service.getFile(repo.path, 'new file.ts');
    assert.equal(added.previous, null);
    assert.match(added.diff, /\+export function added/);
    await assert.rejects(service.getFile(repo.path, 'password.secret'), /listed/);
    await assert.rejects(service.getFile(repo.path, '../outside.ts'), /listed/);
    assert.equal(repo.git('status', '--porcelain=v1'), beforeStatus);
    assert.equal(repo.git('diff', '--cached', '--no-ext-diff'), beforeIndex);
  } finally { await repo.cleanup(); }
});

test('invalid paths and non-Git directories report a recoverable error', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'not a repo '));
  try {
    const service = new ReviewService();
    await assert.rejects(service.openRepository(join(empty, 'missing')), /local Git/);
    await assert.rejects(service.openRepository(empty), /local Git/);
  } finally { await rm(empty, { recursive: true, force: true }); }
});

test('target diff helpers are never executed and symlink targets are not read', async () => {
  const repo = await fixture();
  const { symlink, access } = await import('node:fs/promises');
  const marker = join(repo.path, 'helper-ran');
  try {
    repo.git('config', 'diff.evil.command', `touch '${marker}'`);
    repo.git('config', 'diff.evil.textconv', `touch '${marker}'`);
    await writeFile(join(repo.path, '.gitattributes'), '*.ts diff=evil\n');
    repo.git('add', '.'); repo.git('commit', '-qm', 'attributes');
    await writeFile(join(repo.path, 'main.ts'), 'export const answer = 99;\n');
    await symlink('/etc/passwd', join(repo.path, 'link.ts'));
    const service = new ReviewService();
    const file = await service.getFile(repo.path, 'main.ts');
    assert.match(file.diff, /99/);
    const linked = await service.getFile(repo.path, 'link.ts');
    assert.equal(linked.current?.content, '/etc/passwd');
    assert.match(linked.notice ?? '', /Symbolic link/);
    await assert.rejects(access(marker));
  } finally { await repo.cleanup(); }
});

test('files containing Git pathspec syntax show only their own diff', async () => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, ':special.ts'), 'export const special = 1;\n');
    repo.git('add', '--', './:special.ts'); repo.git('commit', '-qm', 'special filename');
    await writeFile(join(repo.path, ':special.ts'), 'export const special = 2;\n');
    await writeFile(join(repo.path, 'main.ts'), 'export const unrelated = 0;\n');
    const file = await new ReviewService().getFile(repo.path, ':special.ts');
    assert.match(file.diff, /special = 2/);
    assert.doesNotMatch(file.diff, /unrelated/);
  } finally { await repo.cleanup(); }
});
