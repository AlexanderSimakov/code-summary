import { rm } from 'node:fs/promises';
import type { FullConfig } from '@playwright/test';
export default async function teardown(config: FullConfig) {
  await rm(config.metadata.storage, { recursive: true, force: true });
}
