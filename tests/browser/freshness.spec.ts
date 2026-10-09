import { test, expect } from '@playwright/test';
import { fixture } from '../fixture.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('external edits retain source until explicit Refresh', async ({ page }) => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'sample.ts'), 'export function read() { return 42; }\n');
    repo.git('add', '.'); repo.git('commit', '-qm', 'baseline');
    await page.goto('/');
    await page.getByLabel('Repository path').fill(repo.path);
    await page.getByRole('button', { name: 'Open repository' }).click();
    await page.getByRole('button', { name: 'sample.ts unchanged' }).click();
    await expect(page.getByLabel('Source code')).toContainText('42');
    await writeFile(join(repo.path, 'sample.ts'), 'export function read() { return 99; }\n');
    await expect(page.getByText('Review outdated.')).toBeVisible();
    await expect(page.getByLabel('Source code')).toContainText('42');
    await page.getByRole('button', { name: 'Refresh review' }).click();
    await expect(page.getByLabel('Source code')).toContainText('99');
  } finally { await repo.cleanup(); }
});

test('reopening restores a compatible cached explanation without explicit generation', async ({ page }) => {
  const repo = await fixture();
  try {
    const content = 'export function read() { return 42; }\n';
    await writeFile(join(repo.path, 'sample.ts'), content);
    repo.git('add', '.'); repo.git('commit', '-qm', 'baseline');
    let generations = 0;
    await page.route('**/api/analysis/generate', route => { generations++; return route.abort(); });
    await page.route('**/api/analysis/freshness', route => route.fulfill({ json: { outdated: false } }));
    await page.route('**/api/analysis/cache', route => route.fulfill({ json: {
      preview: { id: 'cached', files: [{ path: 'sample.ts', version: 'current', hash: 'cached', content }], functions: [] },
      explanation: { cached: true, previewId: 'cached', files: [], functions: [{ id: 'read', name: 'read', statements: [{ text: 'Returns 42.', uncertainty: null, reference: { path: 'sample.ts', version: 'current', sourceHash: 'cached', startLine: 1, endLine: 1 } }] }] },
    } }));
    await page.goto('/'); await page.getByLabel('Repository path').fill(repo.path);
    await page.getByRole('button', { name: 'Open repository' }).click();
    await page.getByRole('button', { name: 'sample.ts unchanged' }).click();
    await expect(page.getByRole('button', { name: 'Returns 42.' })).toBeVisible();
    await expect(page.getByText('Cached explanation · no new AI request.')).toBeVisible();
    expect(generations).toBe(0);
  } finally { await repo.cleanup(); }
});
