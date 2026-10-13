import { test, expect } from '@playwright/test';
import { fixture } from '../fixture.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

for (const mode of ['analysis', 'comparison'] as const) {
  for (const phase of ['preview', 'generation']) {
    test(`${mode} keeps explicit ${phase} when cache arrives late`, async ({ page }) => {
      const repo = await fixture();
      let release!: () => void;
      const paused = new Promise<void>(resolve => { release = resolve; });
      try {
        const content = 'export function sample() { return 42; }\n';
        await writeFile(join(repo.path, 'sample.ts'), content);
        if (mode === 'analysis') { repo.git('add', '.'); repo.git('commit', '-qm', 'baseline'); }
        await page.route('**/api/settings', route => route.fulfill({ json: { model: 'test/model', configured: true } }));
        let cacheStarted = false;
        await page.route(`**/api/${mode}/cache`, async route => {
          cacheStarted = true;
          await paused;
          await route.fulfill({ json: {
            preview: { id: 'cached-preview', model: 'cached/model', files: [], functions: [] },
            [mode === 'analysis' ? 'explanation' : 'comparison']: { previewId: 'cached-preview', functions: [], uncertainty: 'Cached result.' },
          } }).catch(() => {});
        });
        await page.route(`**/api/${mode}/preview`, route => route.fulfill({ json: { id: 'approved-preview', model: 'approved/model', files: [], functions: [] } }));
        let generations = 0;
        await page.route(`**/api/${mode}/generate`, route => {
          generations++;
          return route.fulfill({ json: reviewResult(mode, 'approved-preview', 'Approved result.') });
        });
        await page.route(`**/api/${mode}/freshness`, route => route.fulfill({ json: { outdated: false } }));
        await page.goto('/');
        await page.getByLabel('Repository path').fill(repo.path);
        await page.getByRole('button', { name: 'Open repository' }).click();
        await page.getByRole('button', { name: `sample.ts ${mode === 'analysis' ? 'unchanged' : 'added'}` }).click();
        await expect.poll(() => cacheStarted).toBe(true);
        await expect(page.getByLabel('OpenRouter model')).toHaveValue('test/model');
        await page.getByRole('button', { name: 'Preview transmission' }).click();
        await expect(page.getByLabel('Transmission preview')).toContainText('approved/model');
        if (phase === 'generation') {
          await page.getByRole('button', { name: 'Generate explanations' }).click();
          await expect(page.getByRole('button', { name: /Approved result/ })).toBeVisible();
        }
        const cacheResponse = page.waitForResponse(`**/api/${mode}/cache`);
        release();
        await cacheResponse;
        await expect(page.getByLabel('Transmission preview')).not.toContainText('cached/model');
        await expect(page.getByLabel('Transmission preview')).toContainText('approved/model');
        if (phase === 'generation') await expect(page.getByRole('button', { name: /Approved result/ })).toBeVisible();
        expect(generations).toBe(phase === 'generation' ? 1 : 0);
      } finally { release(); await repo.cleanup(); }
    });
  }

  for (const phase of ['preview', 'generation']) {
    test(`${mode} ignores late ${phase} after ${phase === 'preview' ? 'file change' : 'mode change'}`, async ({ page }) => {
      const repo = await fixture();
      let release!: () => void;
      const paused = new Promise<void>(resolve => { release = resolve; });
      let finished!: () => void;
      const completed = new Promise<void>(resolve => { finished = resolve; });
      try {
        await writeFile(join(repo.path, 'sample.ts'), 'export function sample() { return 42; }\n');
        await writeFile(join(repo.path, 'other.ts'), 'export function other() { return 99; }\n');
        if (mode === 'analysis') { repo.git('add', '.'); repo.git('commit', '-qm', 'baseline'); }
        await page.route('**/api/settings', route => route.fulfill({ json: { model: 'test/model', configured: true } }));
        await page.route('**/api/*/cache', route => route.fulfill({ json: { preview: { files: [] }, explanation: null, comparison: null } }));
        await page.route('**/api/*/freshness', route => route.fulfill({ json: { outdated: false } }));
        let started = false;
        let previews = 0;
        await page.route(`**/api/${mode}/preview`, async route => {
          const old = ++previews === 1 && phase === 'preview';
          if (old) { started = true; await paused; }
          await route.fulfill({ json: { id: old ? 'old-preview' : 'new-preview', model: old ? 'old/model' : 'new/model', files: [], functions: [] } }).catch(() => {});
          if (old) finished();
        });
        let generations = 0;
        await page.route(`**/api/${mode}/generate`, async route => {
          const old = ++generations === 1;
          if (old) { started = true; await paused; }
          await route.fulfill({ json: reviewResult(mode, 'new-preview', old ? 'Obsolete result.' : 'New result.') }).catch(() => {});
          if (old) finished();
        });
        await page.goto('/');
        await page.getByLabel('Repository path').fill(repo.path);
        await page.getByRole('button', { name: 'Open repository' }).click();
        const status = mode === 'analysis' ? 'unchanged' : 'added';
        await page.getByRole('button', { name: `sample.ts ${status}` }).click();
        await expect(page.getByLabel('OpenRouter model')).toHaveValue('test/model');
        await page.getByRole('button', { name: 'Preview transmission' }).click();
        if (phase === 'generation') await page.getByRole('button', { name: 'Generate explanations' }).click();
        await expect.poll(() => started).toBe(true);
        if (phase === 'preview') {
          await page.getByRole('button', { name: `other.ts ${status}` }).click();
          await expect(page.getByLabel('Source code')).toContainText('return 99');
        } else {
          await page.getByRole('button', { name: mode === 'analysis' ? 'Compare with HEAD' : 'Baseline', exact: true }).click();
          await page.getByRole('button', { name: mode === 'analysis' ? 'Baseline' : 'Compare with HEAD', exact: true }).click();
        }
        await expect(page.getByLabel('Transmission preview')).toHaveCount(0);
        await page.getByRole('button', { name: 'Preview transmission' }).click();
        await expect(page.getByLabel('Transmission preview')).toContainText('new/model');
        if (phase === 'generation') {
          await page.getByRole('button', { name: 'Generate explanations' }).click();
          await expect(page.getByRole('button', { name: /New result/ })).toBeVisible();
        }
        release(); await completed;
        await expect(page.getByLabel('Transmission preview')).toContainText('new/model');
        await expect(page.getByRole('button', { name: /Obsolete result/ })).toHaveCount(0);
        if (phase === 'generation') await expect(page.getByRole('button', { name: /New result/ })).toBeVisible();
        await expect(page.getByRole('alert')).toHaveCount(0);
      } finally { release(); await repo.cleanup(); }
    });
  }
  test(`${mode} ignores outdated freshness from a previous file selection`, async ({ page }) => {
    const repo = await fixture();
    let release!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    try {
      await writeFile(join(repo.path, 'sample.ts'), 'export function sample() { return 42; }\n');
      await writeFile(join(repo.path, 'other.ts'), 'export function other() { return 99; }\n');
      if (mode === 'analysis') { repo.git('add', '.'); repo.git('commit', '-qm', 'baseline'); }
      await page.route('**/api/settings', route => route.fulfill({ json: { model: 'test/model', configured: true } }));
      await page.route(`**/api/${mode}/cache`, route => {
        const { filePath } = route.request().postDataJSON();
        return route.fulfill({ json: { preview: { id: filePath, files: [], functions: [] },
          [mode === 'analysis' ? 'explanation' : 'comparison']: reviewResult(mode, filePath, `Review of ${filePath}.`),
        } });
      });
      let freshnessStarted = false;
      await page.route(`**/api/${mode}/freshness`, async route => {
        const old = route.request().postDataJSON().previewId === 'sample.ts';
        if (old) { freshnessStarted = true; await paused; }
        await route.fulfill({ json: { outdated: old } }).catch(() => {});
      });
      await page.goto('/');
      await page.getByLabel('Repository path').fill(repo.path);
      await page.getByRole('button', { name: 'Open repository' }).click();
      const status = mode === 'analysis' ? 'unchanged' : 'added';
      await page.getByRole('button', { name: `sample.ts ${status}` }).click();
      await expect(page.getByLabel('OpenRouter model')).toHaveValue('test/model');
      await expect.poll(() => freshnessStarted).toBe(true);
      await page.getByRole('button', { name: `other.ts ${status}` }).click();
      await expect(page.getByRole('button', { name: /Review of other.ts/ })).toBeVisible();
      const response = page.waitForResponse(res => res.url().endsWith(`/${mode}/freshness`) && res.request().postDataJSON().previewId === 'sample.ts');
      release(); await response;
      await expect(page.getByText('Review outdated.', { exact: false })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Preview transmission' })).toBeEnabled();
      await expect(page.getByLabel('Source code')).toContainText('return 99');
    } finally { release(); await repo.cleanup(); }
  });

}

function reviewResult(mode: 'analysis' | 'comparison', previewId: string, text: string) {
  const statement = { text, uncertainty: null, reference: { path: 'sample.ts', version: 'current', sourceHash: 'hash', startLine: 1, endLine: 1 } };
  return mode === 'analysis'
    ? { previewId, usage: {}, functions: [{ id: 'sample', name: 'sample', statements: [statement] }] }
    : { previewId, functions: [{ name: 'sample', statements: [{ change: 'added', current: statement }] }], uncertainty: 'Heuristic.' };
}
