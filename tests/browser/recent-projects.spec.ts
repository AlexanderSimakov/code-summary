import { test as base, expect, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createReviewServer } from '../../src/server/http.js';
import { ReviewService } from '../../src/server/review-service.js';
import { fixture } from '../fixture.js';

const test = base.extend<{ history: { connect: (context: BrowserContext) => Promise<void>; service: ReviewService } }>({
  history: async ({}, use) => {
    const storage = await mkdtemp(join(tmpdir(), 'recent-projects-browser-'));
    const service = new ReviewService({ dataDirectory: join(storage, 'history'), cacheDirectory: join(storage, 'cache') });
    const contexts = new Set<BrowserContext>();
    const server = createReviewServer(service);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    try {
      await use({ service, connect: async context => {
        contexts.add(context);
        context.once('close', () => contexts.delete(context));
        await context.route('**/api/**', async route => {
          const response = await route.fetch({ url: `http://127.0.0.1:${address.port}${new URL(route.request().url()).pathname}` });
          await route.fulfill({ response });
        });
      } });
    } finally {
      await Promise.all([...contexts].map(context => context.unrouteAll({ behavior: 'wait' })));
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
      await rm(storage, { recursive: true, force: true });
    }
  },
});

const reopenName = (path: string) => `Open ${basename(path)} ${path}`;

test('recent projects persist across reload and reopen with fresh source and selection', async ({ page, context, history }) => {
  const repo = await fixture();
  try {
    await history.connect(context);
    let generations = 0;
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/analysis/generate') generations++; });
    await page.goto('/');
    const recent = page.getByRole('region', { name: 'Recent projects' });
    await expect(recent).toContainText('No recent projects yet.');
    await page.getByLabel('Repository path').fill(repo.path);
    await page.getByRole('button', { name: 'Open repository', exact: true }).click();
    await expect(recent.getByRole('button', { name: reopenName(repo.path), exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'main.ts unchanged', exact: true }).click();
    await expect(page.getByLabel('Source code')).toContainText('answer');
    await writeFile(join(repo.path, 'main.ts'), 'export const updated = 84;\n');
    await recent.getByRole('button', { name: reopenName(repo.path), exact: true }).click();
    await expect(page.getByText('Select a file to view its source.')).toBeVisible();
    await page.getByRole('button', { name: 'main.ts modified', exact: true }).click();
    await expect(page.getByLabel('Source code')).toContainText('updated');
    await page.reload();
    await expect(recent.getByRole('button', { name: reopenName(repo.path), exact: true })).toBeVisible();
    await expect(page.getByText('Your repository, explained.')).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
    expect(generations).toBe(0);
  } finally { await repo.cleanup(); }
});


test('unavailable recent projects retain the current review and can be forgotten without deleting files', async ({ page, context, history }) => {
  const current = await fixture();
  const missing = await fixture();
  try {
    await history.service.openProject(missing.path);
    await missing.cleanup();
    await history.connect(context);
    await page.goto('/');
    await page.getByLabel('Repository path').fill(current.path);
    await page.getByRole('button', { name: 'Open repository', exact: true }).click();
    await page.getByRole('button', { name: 'main.ts unchanged', exact: true }).click();
    await page.getByRole('button', { name: reopenName(missing.path), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('local Git');
    await expect(page.getByLabel('Source code')).toContainText('answer');
    await expect(page.getByRole('button', { name: reopenName(missing.path), exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Remove ${basename(missing.path)} ${missing.path}`, exact: true }).click();
    await expect(page.getByRole('button', { name: reopenName(missing.path), exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear history', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Recent projects' })).toContainText('No recent projects yet.');
    await expect(page.getByLabel('Source code')).toContainText('answer');
    await page.reload();
    await expect(page.getByRole('region', { name: 'Recent projects' })).toContainText('No recent projects yet.');
    await page.getByLabel('Repository path').fill(current.path);
    await page.getByRole('button', { name: 'Open repository', exact: true }).click();
    await expect(page.getByRole('button', { name: reopenName(current.path), exact: true })).toBeVisible();
  } finally { await current.cleanup(); await missing.cleanup(); }
});

test('two browser contexts share changes on focus without losing concurrent opens', async ({ browser, page, context, history }) => {
  const first = await fixture();
  const second = await fixture();
  const otherContext = await browser.newContext();
  try {
    await history.connect(context); await history.connect(otherContext);
    const other = await otherContext.newPage();
    await Promise.all([page.goto('/'), other.goto('/')]);
    await page.getByLabel('Repository path').fill(first.path);
    await other.getByLabel('Repository path').fill(second.path);
    await Promise.all([page.getByRole('button', { name: 'Open repository', exact: true }).click(), other.getByRole('button', { name: 'Open repository', exact: true }).click()]);
    await expect(page.getByRole('button', { name: reopenName(first.path), exact: true })).toBeVisible();
    await expect(other.getByRole('button', { name: reopenName(second.path), exact: true })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('button', { name: reopenName(second.path), exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Remove ${basename(first.path)} ${first.path}`, exact: true }).click();
    await expect(page.getByRole('button', { name: reopenName(first.path), exact: true })).toHaveCount(0);
    await other.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(other.getByRole('button', { name: reopenName(first.path), exact: true })).toHaveCount(0);
    await expect(other.getByRole('button', { name: reopenName(second.path), exact: true })).toBeVisible();
  } finally { await otherContext.close(); await first.cleanup(); await second.cleanup(); }
});

test('late history reads and open snapshots cannot restore removed shortcuts', async ({ page, context, history }) => {
  const repo = await fixture();
  let releaseRead!: () => void;
  let releaseOpen!: () => void;
  const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
  const openGate = new Promise<void>(resolve => { releaseOpen = resolve; });
  try {
    await history.service.openProject(repo.path);
    await history.connect(context);
    await page.goto('/');
    await expect(page.getByRole('button', { name: reopenName(repo.path), exact: true })).toBeVisible();
    let readStarted!: () => void;
    const reading = new Promise<void>(resolve => { readStarted = resolve; });
    await page.route('**/api/projects/recent', async route => {
      const snapshot = await history.service.getRecentProjects();
      readStarted(); await readGate;
      await route.fulfill({ json: snapshot });
    }, { times: 1 });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await reading;
    await page.getByRole('button', { name: 'Clear history', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Recent projects' })).toContainText('No recent projects yet.');
    const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/projects/recent');
    releaseRead();
    await oldResponse;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.getByRole('button', { name: reopenName(repo.path), exact: true })).toHaveCount(0);
    await page.getByLabel('Repository path').fill(repo.path);
    let openStarted!: () => void;
    const opening = new Promise<void>(resolve => { openStarted = resolve; });
    await page.route('**/api/repository', async route => {
      const snapshot = await history.service.openProject(repo.path);
      openStarted(); await openGate;
      await route.fulfill({ json: snapshot });
    }, { times: 1 });
    await page.getByRole('button', { name: 'Open repository', exact: true }).click();
    await opening;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('button', { name: reopenName(repo.path), exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Clear history', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Recent projects' })).toContainText('No recent projects yet.');
    releaseOpen();
    await expect(page.getByText('Select a file to view its source.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open repository', exact: true })).toBeEnabled();
    await expect(page.getByRole('region', { name: 'Recent projects' })).toContainText('No recent projects yet.');
  } finally { releaseRead(); releaseOpen(); await repo.cleanup(); }
});

test('history save failures warn without blocking review, and focus does not hide the failure', async ({ page, context, history }) => {
  const repo = await fixture();
  try {
    await history.connect(context);
    await page.route('**/api/repository', async route => {
      const snapshot = await history.service.openProject(repo.path);
      await route.fulfill({ json: { ...snapshot, history: { projects: [], warning: 'Opened project could not be saved to history.' } } });
    });
    await page.goto('/');
    await page.getByLabel('Repository path').fill(repo.path);
    await page.getByRole('button', { name: 'Open repository', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Recent projects' })).toContainText('Opened project could not be saved to history.');
    await page.getByRole('button', { name: 'main.ts unchanged', exact: true }).click();
    await expect(page.getByLabel('Source code')).toContainText('answer');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('region', { name: 'Recent projects' })).toContainText('Opened project could not be saved to history.');
    await page.route('**/api/projects/recent/clear', route => route.fulfill({ json: { projects: [{ path: repo.path, name: basename(repo.path) }], warning: 'History change was not saved.' } }));
    await page.getByRole('button', { name: 'Clear history', exact: true }).click();
    await expect(page.getByRole('button', { name: reopenName(repo.path), exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Recent projects' })).toContainText('History change was not saved.');
  } finally { await repo.cleanup(); }
});


test('history read failures keep existing shortcuts and allow manual browsing', async ({ page, context, history }) => {
  const repo = await fixture();
  try {
    await history.service.openProject(repo.path);
    await history.connect(context);
    await page.goto('/');
    await expect(page.getByRole('button', { name: reopenName(repo.path), exact: true })).toBeVisible();
    await page.route('**/api/projects/recent', route => route.fulfill({ status: 503, json: { error: 'History unavailable.' } }));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('region', { name: 'Recent projects' })).toContainText('History unavailable.');
    await expect(page.getByRole('button', { name: reopenName(repo.path), exact: true })).toBeVisible();
    await page.getByLabel('Repository path').fill(repo.path);
    await page.getByRole('button', { name: 'Open repository', exact: true }).click();
    await page.getByRole('button', { name: 'main.ts unchanged', exact: true }).click();
    await expect(page.getByLabel('Source code')).toContainText('answer');
  } finally { await repo.cleanup(); }
});


for (const operation of ['remove', 'clear'] as const) {
  test(`successful ${operation} remains applied when the following history refresh fails`, async ({ page, context, history }) => {
    const first = await fixture();
    const second = await fixture();
    try {
      await history.service.openProject(first.path);
      await history.service.openProject(second.path);
      await history.connect(context);
      await page.goto('/');
      await expect(page.getByRole('button', { name: reopenName(first.path), exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: reopenName(second.path), exact: true })).toBeVisible();
      await page.route('**/api/projects/recent', route => route.fulfill({ status: 503, json: { error: 'Refresh temporarily unavailable.' } }));
      await page.getByRole('button', { name: operation === 'remove' ? `Remove ${basename(first.path)} ${first.path}` : 'Clear history', exact: true }).click();
      const recent = page.getByRole('region', { name: 'Recent projects' });
      await expect(recent).toContainText('Refresh temporarily unavailable.');
      await expect(recent.getByRole('button', { name: reopenName(first.path), exact: true })).toHaveCount(0);
      if (operation === 'remove') {
        await expect(recent.getByRole('button', { name: reopenName(second.path), exact: true })).toBeVisible();
      } else {
        await expect(recent).toContainText('No recent projects yet.');
        await expect(recent.getByRole('button', { name: reopenName(second.path), exact: true })).toHaveCount(0);
      }
    } finally { await first.cleanup(); await second.cleanup(); }
  });
}


test('a successful open appears in history when its list refresh fails', async ({ page, context, history }) => {
  const repo = await fixture();
  try {
    await history.connect(context);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Recent projects' })).toContainText('No recent projects yet.');
    await page.route('**/api/projects/recent', route => route.fulfill({ status: 503, json: { error: 'Refresh temporarily unavailable.' } }));
    await page.getByLabel('Repository path').fill(repo.path);
    await page.getByRole('button', { name: 'Open repository', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Recent projects' })).toContainText('Refresh temporarily unavailable.');
    await expect(page.getByRole('button', { name: reopenName(repo.path), exact: true })).toBeVisible();
    await expect(page.getByText('Select a file to view its source.')).toBeVisible();
  } finally { await repo.cleanup(); }
});

test('a focus read cannot suppress a successful in-flight removal when refreshes fail', async ({ page, context, history }) => {
  const repo = await fixture();
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const removing = new Promise<void>(resolve => { started = resolve; });
  try {
    await history.service.openProject(repo.path);
    await history.connect(context);
    await page.goto('/');
    await expect(page.getByRole('button', { name: reopenName(repo.path), exact: true })).toBeVisible();
    await page.route('**/api/projects/recent/remove', async route => {
      const snapshot = await history.service.removeRecentProject(repo.path);
      started(); await gate;
      await route.fulfill({ json: snapshot });
    });
    await page.route('**/api/projects/recent', route => route.fulfill({ status: 503, json: { error: 'Refresh temporarily unavailable.' } }));
    await page.getByRole('button', { name: `Remove ${basename(repo.path)} ${repo.path}`, exact: true }).click();
    await removing;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('region', { name: 'Recent projects' })).toContainText('Refresh temporarily unavailable.');
    release();
    await expect(page.getByRole('button', { name: reopenName(repo.path), exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Recent projects' })).toContainText('No recent projects yet.');
    await expect(page.getByRole('region', { name: 'Recent projects' })).toContainText('Refresh temporarily unavailable.');
  } finally { release(); await repo.cleanup(); }
});
