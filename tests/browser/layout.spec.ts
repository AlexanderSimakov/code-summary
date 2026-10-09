import { test, expect } from '@playwright/test';
import { fixture } from '../fixture.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('long desktop reviews scroll the page and retain source links when outdated', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  const repo = await fixture();
  try {
    const content = Array.from({ length: 30 }, (_, index) => `export function value${index}() {\n  return ${index};\n}\n`).join('');
    await writeFile(join(repo.path, 'sample.ts'), content);
    repo.git('add', '.'); repo.git('commit', '-qm', 'long review');
    await page.route('**/api/analysis/freshness', route => route.fulfill({ json: { outdated: false } }));
    await page.route('**/api/analysis/cache', route => route.fulfill({ json: {
      preview: { id: 'cached', contextWarnings: ['Shared dependency context is unavailable.'], files: [{ path: 'sample.ts', version: 'current', hash: 'cached', content }], functions: [] },
      explanation: { cached: true, previewId: 'cached', contextWarnings: ['Shared dependency context is unavailable.'], files: [], functions: Array.from({ length: 30 }, (_, index) => ({
        id: `value${index}`, name: `value${index}`, statements: [{ text: `Returns ${index}.`, uncertainty: index === 0 ? 'The return depends on an unresolved definition.' : null,
          reference: { path: 'sample.ts', version: 'current', sourceHash: 'cached', startLine: index * 3 + 2, endLine: index * 3 + 2 } }],
      })) },
    } }));
    await page.goto('/');
    await page.getByLabel('Repository path').fill(repo.path);
    await page.getByRole('button', { name: 'Open repository' }).click();
    await page.getByRole('button', { name: 'sample.ts unchanged' }).click();
    await expect(page.getByText('Context warning: Shared dependency context is unavailable.', { exact: true })).toHaveCount(1);
    await expect(page.getByText('Uncertain: The return depends on an unresolved definition.', { exact: true })).toHaveCount(1);
    const selected = page.getByRole('button', { name: 'Returns 29.', exact: true });
    await selected.click();
    await expect(page.locator('.source-highlight')).toBeInViewport();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
    await expect(selected).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, 0));
    await writeFile(join(repo.path, 'sample.ts'), `${content}\n// external edit\n`);
    await expect(page.getByText('Review outdated.')).toBeVisible();
    const english = await page.getByLabel('English explanations').boundingBox();
    const source = await page.getByLabel('Source pane').boundingBox();
    expect(source!.x).toBeGreaterThan(english!.x + english!.width - 1);
    expect(Math.abs(source!.y - english!.y)).toBeLessThan(2);
  } finally { await repo.cleanup(); }
});
