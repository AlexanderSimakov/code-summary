import { test, expect } from '@playwright/test';
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('a declaration statement reveals its current source on the right', async ({ page }) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'browser declaration repo ')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
  try {
    git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
    await writeFile(join(root, 'sample.ts'), 'export const limit = 3;\n'); git('add', '.'); git('commit', '-qm', 'baseline');
    const current = 'export const limit = 5;\n';
    await writeFile(join(root, 'sample.ts'), current);
    await page.route('**/api/settings', route => route.fulfill({ json: { model: 'test/model', configured: true } }));
    await page.route('**/api/comparison/preview', route => route.fulfill({ json: { id: 'preview', model: 'test/model', previous: null, current: null, files: [{ path: 'sample.ts', version: 'current', content: current, hash: 'new' }] } }));
    await page.route('**/api/comparison/generate', route => route.fulfill({ json: { previewId: 'preview', assessment: null, uncertainty: 'Matching is heuristic.', functions: [{ name: 'limit', kind: 'constant', statements: [{ change: 'added', previous: null, current: { text: 'Sets limit to five.', uncertainty: null, reference: { path: 'sample.ts', version: 'current', sourceHash: 'new', startLine: 1, endLine: 1 } } }] }] } }));
    await page.goto('/'); await page.getByLabel('Repository path').fill(root);
    await page.getByRole('button', { name: 'Open repository' }).click();
    await page.getByRole('button', { name: 'sample.ts modified' }).click();
    await page.getByRole('button', { name: 'Preview transmission' }).click();
    await page.getByRole('button', { name: 'Generate explanations' }).click();
    await expect(page.getByRole('heading', { name: 'limit', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '+ Sets limit to five.' }).click();
    await expect(page.locator('.source-highlight')).toContainText('export const limit = 5;');
    await expect(page.getByRole('button', { name: 'Current source' })).toHaveAttribute('aria-pressed', 'true');
  } finally { await rm(root, { recursive: true, force: true }); }
});
