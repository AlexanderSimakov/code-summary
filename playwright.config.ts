import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Workers inherit the run-scoped path instead of allocating their own storage.
const storage = process.env.CODE_SUMMARY_BROWSER_STORAGE ??= mkdtempSync(join(tmpdir(), 'code-summary-browser-'));
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false,
  metadata: { storage }, globalTeardown: './tests/browser/teardown.ts',
  use: { baseURL: `http://127.0.0.1:${process.env.E2E_PORT ?? 5173}`, headless: true },
  webServer: {
    command: 'npm run dev', url: `http://127.0.0.1:${process.env.E2E_PORT ?? 5173}`, reuseExistingServer: false,
    timeout: 30_000,
    env: { CODE_SUMMARY_DATA_DIR: join(storage, 'history'), CODE_SUMMARY_CACHE_DIR: join(storage, 'cache') },
  },
});
