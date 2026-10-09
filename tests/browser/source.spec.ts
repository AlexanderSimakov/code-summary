import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from '../fixture.js';

test('syntax colors preserve multiline source, escaping, previous versions, and diff lines', async ({ page }) => {
  const repo = await fixture();
  const previous = '/* first line\ncontinued comment */\nexport const message: string = "<script>alert(1)</script>";\n';
  const current = previous.replace('alert(1)', 'alert(2)');
  try {
    await writeFile(join(repo.path, 'sample.ts'), previous);
    await writeFile(join(repo.path, 'notes.txt'), '<b>plain text</b>\n');
    repo.git('add', '.'); repo.git('commit', '-qm', 'syntax fixture');
    await writeFile(join(repo.path, 'sample.ts'), current);
    await page.goto('/');
    await page.getByLabel('Repository path').fill(repo.path);
    await page.getByRole('button', { name: 'Open repository' }).click();
    await page.getByRole('button', { name: 'sample.ts modified', exact: true }).click();
    const code = page.getByLabel('Source code');
    await expect(code.locator('code')).toHaveCount(4);
    await expect(code.locator('code').nth(1)).toHaveText('continued comment */');
    await expect(code.locator('code').nth(1).locator('.hljs-comment')).toHaveText('continued comment */');
    await expect(code.locator('.hljs-string')).toHaveText('"<script>alert(2)</script>"');
    await expect(code.locator('script')).toHaveCount(0);
    const keyword = code.locator('.hljs-keyword').first();
    expect(await keyword.evaluate(element => getComputedStyle(element).color)).not.toBe(
      await code.evaluate(element => getComputedStyle(element).color));
    await page.getByRole('button', { name: 'Previous source', exact: true }).click();
    await expect(code.locator('.hljs-string')).toHaveText('"<script>alert(1)</script>"');
    await page.getByRole('button', { name: 'Git diff', exact: true }).click();
    await expect(code.locator('.addition').filter({ hasText: 'alert(2)' })).toHaveCount(1);
    await expect(code.locator('.removal').filter({ hasText: 'alert(1)' })).toHaveCount(1);
    await page.getByRole('button', { name: 'notes.txt unchanged', exact: true }).click();
    await expect(code.locator('code').first()).toHaveText('<b>plain text</b>');
    await expect(code.locator('b')).toHaveCount(0);
  } finally { await repo.cleanup(); }
});
