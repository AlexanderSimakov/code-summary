import { test, expect } from '@playwright/test';
import { fixture } from '../fixture.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('preview exposes cross-file source, missing context and a user-controlled byte limit', async ({ page }) => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.path, 'main.ts'), 'import { deliver } from "./delivery";\nimport unknown from "./missing";\nexport function run() { return deliver(); }\n');
    await writeFile(join(repo.path, 'delivery.ts'), 'export function deliver() { return "queued"; }\n');
    await page.goto('/');
    await page.getByLabel('Repository path').fill(repo.path);
    await page.getByRole('button', { name: 'Open repository' }).click();
    await page.getByRole('button', { name: 'main.ts modified' }).click();
    await page.getByRole('button', { name: 'Preview transmission' }).click();
    const preview = page.getByLabel('Transmission preview');
    await expect(preview).toContainText('delivery.ts · current');
    await expect(preview).toContainText('missing');
    await expect(preview).toContainText('could not be resolved');
    await page.getByLabel('Context limit (bytes)').fill('10');
    await expect(preview).not.toBeVisible();
    await page.getByRole('button', { name: 'Preview transmission' }).click();
    await expect(page.getByLabel('Transmission preview')).toContainText('Selected source exceeds the context limit');
    await expect(page.getByRole('button', { name: 'Generate explanations' })).toBeDisabled();
    await expect(page.getByLabel('Source code')).toContainText('return deliver()');
  } finally { await repo.cleanup(); }
});
