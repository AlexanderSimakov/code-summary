import { test, expect } from '@playwright/test';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from '../fixture.js';

test('browse nested folders with changes and select current or deleted source', async ({ page }) => {
  const repo = await fixture();
  try {
    await mkdir(join(repo.path, 'src/core'), { recursive: true });
    await mkdir(join(repo.path, 'lib'), { recursive: true });
    await writeFile(join(repo.path, 'src/main.ts'), 'export const nested = 1;\n');
    await writeFile(join(repo.path, 'src/core/helper.ts'), 'export const helper = 2;\n');
    await writeFile(join(repo.path, 'lib/removed.ts'), 'export const removed = 3;\n');
    repo.git('add', '.'); repo.git('commit', '-qm', 'nested source');
    await writeFile(join(repo.path, 'src/main.ts'), 'export const nested = 4;\n');
    await writeFile(join(repo.path, 'src/core/new.ts'), 'export const added = 5;\n');
    await writeFile(join(repo.path, 'src/ignored.secret'), 'ignored');
    await unlink(join(repo.path, 'lib/removed.ts'));

    await page.goto('/');
    await page.getByLabel('Repository path').fill(repo.path);
    await page.getByRole('button', { name: 'Open repository' }).click();
    const sidebar = page.getByRole('navigation', { name: 'Repository files' });
    const src = sidebar.getByRole('button', { name: 'Folder src', exact: true });
    const core = sidebar.getByRole('button', { name: 'Folder src/core', exact: true });
    await expect(src).toHaveAttribute('aria-expanded', 'true');
    await expect(src.getByLabel('2 changed files')).toBeVisible();
    await expect(core).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebar.getByRole('button', { name: 'src/core/new.ts added' })).toHaveCount(0);
    await expect(sidebar).not.toContainText('ignored.secret');
    await expect(sidebar.getByRole('button', { name: 'src/main.ts modified' })).toContainText('main.ts');
    await expect(sidebar.getByRole('button', { name: 'src/main.ts modified' })).not.toContainText('src/');

    await core.click();
    await sidebar.getByRole('button', { name: 'src/core/new.ts added' }).click();
    await expect(page.getByLabel('Source code')).toContainText('export const added = 5;');
    await expect(sidebar.getByRole('button', { name: 'src/core/new.ts added' })).toHaveAttribute('aria-current', 'page');
    await src.click();
    await expect(src).toHaveAttribute('aria-expanded', 'false');
    await expect(src.getByLabel('2 changed files')).toBeVisible();
    await expect(core).toHaveCount(0);
    await src.focus(); await page.keyboard.press('Enter');
    await expect(core).toHaveAttribute('aria-expanded', 'true');
    await sidebar.getByRole('button', { name: 'main.ts unchanged', exact: true }).click();
    await expect(page.getByLabel('Source code')).toContainText('export const answer = 42;');
    await sidebar.getByRole('button', { name: 'lib/removed.ts deleted' }).click();
    await expect(page.getByLabel('Source code')).toContainText('export const removed = 3;');
    await expect(page.getByRole('button', { name: 'Previous source' })).toHaveAttribute('aria-pressed', 'true');
  } finally { await repo.cleanup(); }
});
