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

test('comparison cancellation discards a late response and permits explicit retry', async ({ page }) => {
  const { fixture } = await import('../fixture.js');
  const repo = await fixture();
  let release!: () => void;
  try {
    await writeFile(join(repo.path, 'sample.ts'), 'export function sample() { return 42; }\n');
    let calls = 0;
    const paused = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/settings', route => route.fulfill({ json: { model: 'test/model', configured: true } }));
    await page.route('**/api/comparison/preview', route => route.fulfill({ json: { id: 'comparison', model: 'test/model', previous: null, current: null, files: [] } }));
    await page.route('**/api/comparison/generate', async route => {
      const call = ++calls;
      if (call === 1) await paused;
      await route.fulfill({ json: { previewId: 'comparison', functions: [{ name: 'sample', statements: [{ change: 'added', previous: null, current: { text: call === 1 ? 'Late result.' : 'Returns 42.', uncertainty: null, reference: {} } }] }], uncertainty: 'Heuristic.' } }).catch(() => {});
    });
    await page.goto('/'); await page.getByLabel('Repository path').fill(repo.path);
    await page.getByRole('button', { name: 'Open repository' }).click();
    await page.getByRole('button', { name: 'sample.ts added' }).click();
    await page.getByRole('button', { name: 'Preview transmission' }).click();
    await page.getByRole('button', { name: 'Generate explanations' }).click();
    await expect.poll(() => calls).toBe(1);
    await page.getByRole('button', { name: 'Cancel generation' }).click(); release();
    await expect(page.getByText('Late result.', { exact: false })).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry generation' }).click();
    await expect(page.getByRole('button', { name: '+ Returns 42.' })).toBeVisible();
  } finally { release?.(); await repo.cleanup(); }
});


test('unchanged callers can explicitly compare dependency-only changes against HEAD', async ({ page }) => {
  const { fixture } = await import('../fixture.js');
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'main.ts'), 'import { limit } from "./limit";\nexport function attempts() { return limit; }\n');
    await writeFile(join(repo.path, 'limit.ts'), 'export const limit = 3;\n');
    repo.git('add', '.'); repo.git('commit', '-qm', 'baseline');
    await writeFile(join(repo.path, 'limit.ts'), 'export const limit = 5;\n');
    await page.goto('/'); await page.getByLabel('Repository path').fill(repo.path);
    await page.getByRole('button', { name: 'Open repository' }).click();
    await page.route('**/api/comparison/generate', route => route.fulfill({ json: { previewId: 'dependency', functions: [{ name: 'attempts', statements: [{ change: 'modified', previous: { text: 'Returns limit three.', reference: { path: 'main.ts', version: 'previous', startLine: 2, endLine: 2 } }, current: { text: 'Returns limit five.', reference: { path: 'main.ts', version: 'current', startLine: 2, endLine: 2 } } }] }], uncertainty: 'Heuristic.' } }));
    await page.getByRole('button', { name: 'main.ts unchanged' }).click();
    await page.getByRole('button', { name: 'Compare with HEAD', exact: true }).click();
    await page.getByRole('button', { name: 'Preview transmission' }).click();
    await expect(page.getByLabel('Transmission preview')).toContainText('limit.ts · previous');
    await expect(page.getByLabel('Transmission preview')).toContainText('limit.ts · current');
    await expect(page.getByLabel('Transmission preview')).toContainText('limit = 3');
    await expect(page.getByLabel('Transmission preview')).toContainText('limit = 5');
    await page.getByRole('button', { name: 'Generate explanations' }).click();
    await expect(page.getByRole('button', { name: '− Returns limit three.' })).toBeVisible();
    await page.getByRole('button', { name: '+ Returns limit five.' }).click();
    await expect(page.locator('.source-highlight')).toContainText('return limit');
    await page.getByRole('button', { name: 'Baseline', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Compare with HEAD', exact: true })).toHaveAttribute('aria-pressed', 'false');
  } finally { await repo.cleanup(); }
});
