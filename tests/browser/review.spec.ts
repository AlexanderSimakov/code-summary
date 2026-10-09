import { test, expect } from '@playwright/test';
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('open a clean repository, select source, and recover from a bad path', async ({ page }) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'browser source repo ')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
  try {
    git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
    await writeFile(join(root, 'sample.ts'), 'export function originalName() { return 42; }\n');
    git('add', '.'); git('commit', '-qm', 'baseline');
    await page.goto('/');
    await page.getByLabel('Repository path').fill(root);
    await page.getByRole('button', { name: 'Open repository' }).click();
    await expect(page.getByText('No changes against HEAD')).toBeVisible();
    await page.getByRole('button', { name: 'sample.ts unchanged' }).click();
    await expect(page.getByLabel('Source code')).toContainText('originalName');
    await page.getByRole('button', { name: 'Git diff' }).click();
    await expect(page.getByText('No source changes against HEAD.')).toBeVisible();
    await page.getByLabel('Repository path').fill(join(root, 'missing'));
    await page.getByRole('button', { name: 'Open repository' }).click();
    await expect(page.getByRole('alert')).toContainText('local Git');
  } finally { await rm(root, { recursive: true, force: true }); }
});
