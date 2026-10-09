import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
export async function fixture() {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'code summary repo '))); 
  const git = (...args: string[]) => execFileSync('git', args, { cwd: path, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  await writeFile(join(path, 'main.ts'), 'export const answer = 42;\n');
  await writeFile(join(path, '.gitignore'), '*.secret\n');
  git('add', '.');
  git('commit', '-qm', 'baseline');
  return { path, git, cleanup: () => rm(path, { recursive: true, force: true }) };
}

