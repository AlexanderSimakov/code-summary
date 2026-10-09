import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RecentProject, RecentProjectsResult } from '../shared/review.js';

/** Persistent navigation history, separate from repository files and explanation cache. */
export class RecentProjects {
  private readonly directory: string;
  private queue: Promise<unknown> = Promise.resolve();
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action);
    this.queue = next.catch(() => {});
    return next;
  }
  constructor(directory?: string) {
    this.directory = directory ?? process.env.CODE_SUMMARY_DATA_DIR ?? join(homedir(), '.code-summary');
  }
  list(): Promise<RecentProjectsResult> { return this.serialize(async () => (await this.read()).result); }
  private async read(): Promise<{ result: RecentProjectsResult; writable: boolean }> {
    let text: string;
    try { text = await readFile(join(this.directory, 'recent-projects.json'), 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { result: { projects: [] }, writable: true };
      return { result: { projects: [], warning: 'Could not read project history. Repository browsing remains available; history was not changed.' }, writable: false };
    }
    try {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('projects' in value) || !Array.isArray(value.projects) || value.projects.length > 10) throw new Error('Invalid history');
      const projects: RecentProject[] = [];
      for (const project of value.projects) {
        if (!project || typeof project.path !== 'string' || !isAbsolute(project.path) || project.path.includes('\0') || project.name !== basename(project.path) || projects.some(previous => previous.path === project.path)) throw new Error('Invalid project');
        projects.push({ path: project.path, name: project.name });
      }
      return { result: { projects }, writable: true };
    } catch { return { result: { projects: [], warning: 'Saved project history is malformed. Recovered an empty recent-project list.' }, writable: true }; }
  }
  record(path: string): Promise<RecentProjectsResult> {
    return this.mutate(projects => [{ path, name: basename(path) }, ...projects.filter(project => project.path !== path)].slice(0, 10));
  }
  remove(path: string): Promise<RecentProjectsResult> { return this.mutate(projects => projects.filter(project => project.path !== path)); }
  clear(): Promise<RecentProjectsResult> { return this.mutate(() => []); }
  private mutate(update: (projects: RecentProject[]) => RecentProject[]): Promise<RecentProjectsResult> {
    return this.serialize(async () => {
      const { result, writable } = await this.read();
      if (!writable) return result;
      const projects = update(result.projects);
      const temporary = join(this.directory, `.recent-projects-${randomUUID()}.tmp`);
      try {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        await writeFile(temporary, JSON.stringify({ version: 1, projects }), { mode: 0o600, flag: 'wx' });
        await rename(temporary, join(this.directory, 'recent-projects.json'));
      } catch {
        return { projects: result.projects, warning: [result.warning, 'Could not save project history. The requested history change was not saved.'].filter(Boolean).join(' ') };
      } finally { await rm(temporary, { force: true }).catch(() => {}); }
      return { projects, ...(result.warning ? { warning: result.warning } : {}) };
    });
  }
}
