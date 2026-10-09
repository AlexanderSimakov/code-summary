import { test, expect } from '@playwright/test';
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('open a clean repository, select source, and recover from a bad path', async ({ page }) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'browser source repo ')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
  try {
    git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
    await writeFile(join(root, 'sample.ts'), 'export function originalName() { return 42; }\n');
    git('add', '.'); git('commit', '-qm', 'baseline');
    await page.goto('/');
    await page.getByLabel('Repository path').fill(root);
    await page.getByRole('button', { name: 'Open repository' }).click();
    await expect(page.getByText('No changes against HEAD')).toBeVisible();
    await page.getByRole('button', { name: 'sample.ts unchanged' }).click();
    await expect(page.getByLabel('Source code')).toContainText('originalName');
    await page.getByRole('button', { name: 'Git diff' }).click();
    await expect(page.getByText('No source changes against HEAD.')).toBeVisible();
    await page.getByLabel('Repository path').fill(join(root, 'missing'));
    await page.getByRole('button', { name: 'Open repository' }).click();
    await expect(page.getByRole('alert')).toContainText('local Git');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('explicit preview and generation render linked statements on the left', async ({ page }) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'browser explanation repo ')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
  try {
    git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
    await writeFile(join(root, 'sample.ts'), 'export function originalName() {\n  return 42;\n}\n');
    git('add', '.'); git('commit', '-qm', 'baseline');
    // Browser smoke uses the HTTP boundary; parser/provider behavior is covered at ReviewService.
    await page.route('**/api/settings', route => route.fulfill({ json: { model: 'test/model', configured: true } }));
    await page.route('**/api/analysis/preview', route => route.fulfill({ json: { id: 'preview', repositoryPath: root, filePath: 'sample.ts', model: 'test/model', files: [{ path: 'sample.ts', version: 'current', hash: 'hash', content: 'export function originalName() {\n  return 42;\n}\n' }], functions: [{ id: 'fn', name: 'originalName', startLine: 1, endLine: 3 }] } }));
    let generations = 0;
    await page.route('**/api/analysis/generate', route => { generations++; return route.fulfill({ json: { previewId: 'preview', model: 'test/model', files: [], functions: [{ id: 'fn', name: 'originalName', startLine: 1, endLine: 3, statements: [{ text: 'Returns 42.', uncertainty: null, reference: { path: 'sample.ts', version: 'current', sourceHash: 'hash', startLine: 2, endLine: 2 } }] }] } }); });
    await page.goto('/');
    await page.getByLabel('Repository path').fill(root);
    await page.getByRole('button', { name: 'Open repository' }).click();
    await page.getByRole('button', { name: 'sample.ts unchanged' }).click();
    await page.getByRole('button', { name: 'Preview transmission' }).click();
    await expect(page.getByLabel('Transmission preview')).toContainText('sample.ts');
    expect(generations).toBe(0);
    await page.getByRole('button', { name: 'Generate explanations' }).click();
    await page.getByRole('button', { name: 'Returns 42.' }).click();
    await expect(page.locator('.source-highlight')).toContainText('return 42');
    await expect(page.getByRole('heading', { name: 'originalName' })).toBeVisible();
  } finally { await rm(root, { recursive: true, force: true }); }
});
