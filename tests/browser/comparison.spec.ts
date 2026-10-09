import { test, expect } from '@playwright/test';
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('English diff selects previous and current source while keeping Git diff available', async ({ page }) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'browser comparison repo ')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
  try {
    git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
    const previous = 'export function work() {\n  return 3;\n}\n';
    const current = 'export function work() {\n  return 5;\n}\n';
    await writeFile(join(root, 'sample.ts'), previous); git('add', '.'); git('commit', '-qm', 'baseline');
    await writeFile(join(root, 'sample.ts'), current);
    await page.route('**/api/settings', route => route.fulfill({ json: { model: 'test/model', configured: true } }));
    await page.route('**/api/comparison/preview', route => route.fulfill({ json: { id: 'preview', model: 'test/model', previous: null, current: null, files: [{ path: 'sample.ts', version: 'previous', content: previous, hash: 'old' }, { path: 'sample.ts', version: 'current', content: current, hash: 'new' }] } }));
    const statement = (version: string, text: string) => ({ text, uncertainty: null, reference: { path: 'sample.ts', version, sourceHash: version === 'previous' ? 'old' : 'new', startLine: 2, endLine: 2 } });
    await page.route('**/api/comparison/generate', route => route.fulfill({ json: { previewId: 'preview', assessment: null, uncertainty: 'Matching is heuristic.', functions: [{ name: 'work', statements: [{ change: 'modified', previous: statement('previous', 'Returns 3.'), current: statement('current', 'Returns 5.') }] }] } }));
    await page.goto('/'); await page.getByLabel('Repository path').fill(root);
    await page.getByRole('button', { name: 'Open repository' }).click();
    await page.getByRole('button', { name: 'sample.ts modified' }).click();
    await page.getByRole('button', { name: 'Preview transmission' }).click();
    await expect(page.getByLabel('Transmission preview')).toContainText('previous');
    await expect(page.getByLabel('Transmission preview')).toContainText('current');
    await page.getByRole('button', { name: 'Generate explanations' }).click();
    await page.getByRole('button', { name: '− Returns 3.' }).click();
    await expect(page.getByRole('button', { name: 'Previous source' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.source-highlight')).toContainText('return 3');
    await page.getByRole('button', { name: '+ Returns 5.' }).click();
    await expect(page.locator('.source-highlight')).toContainText('return 5');
    await page.getByRole('button', { name: 'Git diff' }).click();
    await expect(page.getByLabel('Source code')).toContainText('-  return 3');
    await expect(page.getByLabel('Source code')).toContainText('+  return 5');
  } finally { await rm(root, { recursive: true, force: true }); }
});
