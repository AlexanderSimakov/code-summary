import { test, expect } from '@playwright/test';
import { fixture } from '../fixture.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('cancel, ignore a late response, retry a failure explicitly, and inspect honest usage', async ({ page }) => {
  const repo = await fixture();
  try {
    const content = 'export function sample() { return 42; }\n';
    await writeFile(join(repo.path, 'sample.ts'), content);
    repo.git('add', '.'); repo.git('commit', '-qm', 'sample baseline');
    await page.route('**/api/settings', route => route.fulfill({ json: { model: 'test/model', configured: true } }));
    await page.route('**/api/analysis/preview', route => route.fulfill({ json: { id: 'preview', repositoryPath: repo.path, filePath: 'sample.ts', model: 'test/model', files: [{ path: 'sample.ts', version: 'current', hash: 'hash', content }], functions: [{ id: 'fn', name: 'sample', startLine: 1, endLine: 1 }] } }));
    let calls = 0;
    let release!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/analysis/generate', async route => {
      const call = ++calls;
      if (call === 1) await paused;
      if (call === 2) return route.fulfill({ status: 400, json: { error: 'OpenRouter authentication failed. Check OPENROUTER_API_KEY.' } });
      await route.fulfill({ json: { previewId: 'preview', model: 'test/model', files: [], usage: call === 1 ? {} : { promptTokens: 100, cost: 0.002 }, functions: [{ id: 'fn', name: 'sample', startLine: 1, endLine: 1, statements: [{ text: call === 1 ? 'Late cancelled explanation.' : 'Returns 42.', uncertainty: null, reference: { path: 'sample.ts', version: 'current', sourceHash: 'hash', startLine: 1, endLine: 1 } }] }] } }).catch(() => {});
    });
    await page.goto('/');
    await page.getByLabel('Repository path').fill(repo.path);
    await page.getByRole('button', { name: 'Open repository' }).click();
    await page.getByRole('button', { name: 'sample.ts unchanged' }).click();
    await page.getByRole('button', { name: 'Preview transmission' }).click();
    await page.getByRole('button', { name: 'Generate explanations' }).click();
    await expect.poll(() => calls).toBe(1);
    await page.getByRole('button', { name: 'Cancel generation' }).click();
    release();
    await expect(page.getByRole('alert')).toContainText('Provider charges may still apply');
    await expect(page.getByText('Late cancelled explanation.')).toHaveCount(0);
    await expect(page.getByLabel('Source code')).toContainText('return 42');
    expect(calls).toBe(1);
    await page.getByRole('button', { name: 'Retry generation' }).click();
    await expect(page.getByRole('alert')).toContainText('authentication failed');
    expect(calls).toBe(2);
    await expect(page.getByLabel('Source code')).toContainText('return 42');
    await page.getByRole('button', { name: 'Retry generation' }).click();
    await expect(page.getByRole('button', { name: 'Returns 42.' })).toBeVisible();
    await expect(page.getByLabel('Reported AI usage')).toContainText('Input tokens: 100');
    await expect(page.getByLabel('Reported AI usage')).toContainText('Output tokens: Unavailable');
    await expect(page.getByLabel('Reported AI usage')).toContainText('Cost (credits): 0.002');
    expect(calls).toBe(3);
  } finally { await repo.cleanup(); }
});

for (const mode of ['analysis', 'comparison']) {
  test(`${mode} hides incompatible results after model and context changes with a cache miss`, async ({ page }) => {
    const repo = await fixture();
    try {
      const content = 'export function sample() { return 42; }\n';
      await writeFile(join(repo.path, 'sample.ts'), content);
      if (mode === 'analysis') { repo.git('add', '.'); repo.git('commit', '-qm', 'baseline'); }
      await page.route('**/api/settings', route => route.fulfill({ json: { model: 'test/model', configured: true } }));
      const result = mode === 'analysis'
        ? { previewId: 'preview', usage: {}, functions: [{ id: 'fn', name: 'sample', statements: [{ text: 'Old configuration result.', uncertainty: null, reference: {} }] }] }
        : { previewId: 'preview', functions: [{ name: 'sample', statements: [{ change: 'added', current: { text: 'Old configuration result.', uncertainty: null, reference: {} } }] }], uncertainty: 'Heuristic.' };
      await page.route(`**/api/${mode}/freshness`, route => route.fulfill({ json: { outdated: false } }));
      await page.route(`**/api/${mode}/cache`, route => route.fulfill({ json: { preview: { id: 'preview', files: [] }, [mode === 'analysis' ? 'explanation' : 'comparison']: null } }));
      await page.route(`**/api/${mode}/preview`, route => route.fulfill({ json: { id: 'preview', model: 'test/model', files: [], functions: [] } }));
      await page.route(`**/api/${mode}/generate`, route => route.fulfill({ json: result }));
      await page.goto('/'); await page.getByLabel('Repository path').fill(repo.path);
      await page.getByRole('button', { name: 'Open repository' }).click();
      await page.getByRole('button', { name: `sample.ts ${mode === 'analysis' ? 'unchanged' : 'added'}` }).click();
      for (const setting of ['model', 'context']) {
        await page.getByRole('button', { name: 'Preview transmission' }).click();
        await page.getByRole('button', { name: 'Generate explanations' }).click();
        await expect(page.getByRole('button', { name: /Old configuration result/ })).toBeVisible();
        if (setting === 'model') await page.getByLabel('OpenRouter model').fill('another/model');
        else await page.getByLabel('Context limit (bytes)').fill('32000');
        await expect(page.getByRole('button', { name: /Old configuration result/ })).toHaveCount(0);
      }
    } finally { await repo.cleanup(); }
  });
}
