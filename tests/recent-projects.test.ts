import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile, mkdir, chmod, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { ReviewService } from '../src/server/review-service.js';
import { fixture } from './fixture.js';

async function historyFixture() {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'code-summary-history-'));
  return { dataDirectory, service: new ReviewService({ dataDirectory }), cleanup: () => rm(dataDirectory, { recursive: true, force: true }) };
}

test('successful explicit opens are remembered across service restarts', async () => {
  const repo = await fixture();
  const history = await historyFixture();
  try {
    assert.deepEqual(await history.service.getRecentProjects(), { projects: [] });
    const opened = await history.service.openProject(repo.path);
    assert.equal(opened.root, repo.path);
    assert.ok(opened.files.some(file => file.path === 'main.ts'));
    assert.deepEqual(opened.history, { projects: [{ path: repo.path, name: basename(repo.path) }] });
    assert.deepEqual(await new ReviewService({ dataDirectory: history.dataDirectory }).getRecentProjects(), opened.history);
  } finally { await repo.cleanup(); await history.cleanup(); }
});

test('overlapping explicit opens preserve every project instead of replacing another tab history', async () => {
  const repos = await Promise.all([fixture(), fixture(), fixture()]);
  const history = await historyFixture();
  try {
    await Promise.all(repos.map(repo => history.service.openProject(repo.path)));
    assert.deepEqual(new Set((await history.service.getRecentProjects()).projects.map(project => project.path)), new Set(repos.map(repo => repo.path)));
  } finally { await Promise.all(repos.map(repo => repo.cleanup())); await history.cleanup(); }
});

test('targeted removal and clear forget only shortcuts and allow projects to return', async () => {
  const repos = await Promise.all([fixture(), fixture()]);
  const history = await historyFixture();
  try {
    for (const repo of repos) await history.service.openProject(repo.path);
    const source = await history.service.getFile(repos[0].path, 'main.ts');
    assert.deepEqual((await history.service.removeRecentProject(repos[0].path)).projects.map(project => project.path), [repos[1].path]);
    assert.deepEqual((await history.service.clearRecentProjects()).projects, []);
    assert.deepEqual(await history.service.getFile(repos[0].path, 'main.ts'), source);
    assert.equal((await history.service.openProject(repos[0].path)).history.projects[0].path, repos[0].path);
    await history.service.clearRecentProjects();
    assert.deepEqual((await new ReviewService({ dataDirectory: history.dataDirectory }).getRecentProjects()).projects, []);
  } finally { await Promise.all(repos.map(repo => repo.cleanup())); await history.cleanup(); }
});

test('malformed history shows a warning and recovers without blocking repository opening', async () => {
  const repo = await fixture();
  const history = await historyFixture();
  try {
    await writeFile(join(history.dataDirectory, 'recent-projects.json'), '{broken');
    const recovered = await history.service.getRecentProjects();
    assert.deepEqual(recovered.projects, []);
    assert.match(recovered.warning ?? '', /history/i);
    const opened = await history.service.openProject(repo.path);
    assert.equal(opened.root, repo.path);
    assert.equal(opened.history.projects[0].path, repo.path);
    assert.ok(opened.history.warning);
    assert.equal((await history.service.getRecentProjects()).warning, undefined);
  } finally { await repo.cleanup(); await history.cleanup(); }
});

test('unreadable history never blocks opening or gets overwritten as an empty list', async () => {
  const repo = await fixture();
  const history = await historyFixture();
  const saved = join(history.dataDirectory, 'recent-projects.json');
  try {
    await history.service.openProject(repo.path);
    const original = await readFile(saved, 'utf8');
    await chmod(saved, 0o000);
    assert.ok((await history.service.getRecentProjects()).warning);
    assert.equal((await history.service.openProject(repo.path)).root, repo.path);
    assert.ok((await history.service.clearRecentProjects()).warning);
    await chmod(saved, 0o600);
    assert.equal(await readFile(saved, 'utf8'), original);
    assert.equal((await history.service.getRecentProjects()).projects[0].path, repo.path);
  } finally { await chmod(saved, 0o600).catch(() => {}); await repo.cleanup(); await history.cleanup(); }
});

test('failed saves return the previous history and warn without blocking a successful open', async () => {
  const repos = await Promise.all([fixture(), fixture()]);
  const history = await historyFixture();
  try {
    const original = (await history.service.openProject(repos[0].path)).history.projects;
    await chmod(history.dataDirectory, 0o500);
    const opened = await history.service.openProject(repos[1].path);
    assert.equal(opened.root, repos[1].path);
    assert.deepEqual(opened.history.projects, original);
    assert.match(opened.history.warning ?? '', /save/i);
    const removed = await history.service.removeRecentProject(repos[0].path);
    assert.deepEqual(removed.projects, original);
    assert.ok(removed.warning);
    const cleared = await history.service.clearRecentProjects();
    assert.deepEqual(cleared.projects, original);
    assert.ok(cleared.warning);
    await chmod(history.dataDirectory, 0o700);
    assert.deepEqual((await history.service.getRecentProjects()).projects, original);
  } finally { await chmod(history.dataDirectory, 0o700); await Promise.all(repos.map(repo => repo.cleanup())); await history.cleanup(); }
});

test('valid JSON with invalid project entries is recovered as malformed history', async () => {
  const history = await historyFixture();
  try {
    for (const contents of [JSON.stringify({ projects: [null] }), JSON.stringify({ projects: [{ path: '../relative', name: 'relative' }] }), JSON.stringify({ version: 99, projects: [] })]) {
      await writeFile(join(history.dataDirectory, 'recent-projects.json'), contents);
      const result = await history.service.getRecentProjects();
      assert.deepEqual(result.projects, []);
      assert.match(result.warning ?? '', /malformed/i);
    }
  } finally { await history.cleanup(); }
});

test('history keeps the last ten projects newest first, promotes reopens, and ignores failed opens', async () => {
  const repos = await Promise.all(Array.from({ length: 11 }, () => fixture()));
  const history = await historyFixture();
  try {
    for (const repo of repos) await history.service.openProject(repo.path);
    const paths = async () => (await history.service.getRecentProjects()).projects.map(project => project.path);
    assert.deepEqual(await paths(), [repos[10].path, repos[9].path, repos[8].path, repos[7].path, repos[6].path, repos[5].path, repos[4].path, repos[3].path, repos[2].path, repos[1].path]);
    await history.service.openProject(repos[4].path);
    const ordered = await paths();
    assert.deepEqual(ordered, [repos[4].path, repos[10].path, repos[9].path, repos[8].path, repos[7].path, repos[6].path, repos[5].path, repos[3].path, repos[2].path, repos[1].path]);
    await repos[4].cleanup();
    await assert.rejects(history.service.openProject(repos[4].path), /local Git/);
    await assert.rejects(history.service.openProject(join(history.dataDirectory, 'missing')), /local Git/);
    assert.deepEqual(await paths(), ordered);
  } finally { await Promise.all(repos.map(repo => repo.cleanup())); await history.cleanup(); }
});

test('subfolders and symlinks share the resolved root while Git worktrees remain separate projects', async () => {
  const repo = await fixture();
  const history = await historyFixture();
  try {
    await mkdir(join(repo.path, 'nested'));
    const alias = join(history.dataDirectory, 'alias');
    await symlink(repo.path, alias);
    const worktree = join(history.dataDirectory, 'worktree');
    repo.git('worktree', 'add', '-q', '-b', 'separate-checkout', worktree);
    const separate = await history.service.openProject(worktree);
    await history.service.openProject(repo.path);
    await history.service.openProject(join(repo.path, 'nested'));
    const opened = await history.service.openProject(alias);
    assert.deepEqual(opened.history.projects.map(project => project.path), [repo.path, separate.root]);
    assert.notEqual(separate.root, repo.path);
  } finally { await repo.cleanup(); await history.cleanup(); }
});

test('background review reads do not change recency and forgetting history preserves source and explanations', async () => {
  const repos = await Promise.all([fixture(), fixture()]);
  const history = await historyFixture();
  let providerRequests = 0;
  const service = new ReviewService({ dataDirectory: history.dataDirectory, cacheDirectory: join(history.dataDirectory, 'cache'), apiKey: 'test', transport: async preview => {
    providerRequests++;
    return { content: { functions: preview.functions.map(fn => ({ id: fn.id, name: fn.name, statements: [{ text: 'Returns 42.', startLine: fn.startLine, endLine: fn.endLine, uncertainty: null }] })) } };
  } });
  try {
    await writeFile(join(repos[0].path, 'main.ts'), 'export function answer() { return 42; }\n');
    for (const repo of repos) await service.openProject(repo.path);
    const original = await service.getRecentProjects();
    const beforeGit = repos[0].git('status', '--porcelain=v1');
    const beforeSource = await service.getFile(repos[0].path, 'main.ts');
    const preview = await service.prepareAnalysis(repos[0].path, 'main.ts');
    await service.generateExplanation(preview.id);
    const cachedBefore = await service.getCachedAnalysis(repos[0].path, 'main.ts');
    await service.openRepository(repos[0].path);
    await service.getAnalysisFreshness(preview.id);
    const comparison = await service.prepareComparison(repos[0].path, 'main.ts');
    await service.getComparisonFreshness(comparison.id);
    await service.getCachedAnalysis(repos[0].path, 'main.ts');
    assert.deepEqual(await service.getRecentProjects(), original);
    await service.removeRecentProject(repos[0].path);
    await service.clearRecentProjects();
    await service.openProject(repos[0].path);
    const cached = await service.getCachedAnalysis(repos[0].path, 'main.ts');
    assert.deepEqual(cached.explanation?.functions, cachedBefore.explanation?.functions);
    assert.equal(providerRequests, 1);
    assert.deepEqual(await service.getFile(repos[0].path, 'main.ts'), beforeSource);
    assert.equal(repos[0].git('status', '--porcelain=v1'), beforeGit);
  } finally { await Promise.all(repos.map(repo => repo.cleanup())); await history.cleanup(); }
});

test('overlapping targeted removal and a new open preserve unrelated projects', async () => {
  const repos = await Promise.all([fixture(), fixture(), fixture()]);
  const history = await historyFixture();
  try {
    await history.service.openProject(repos[0].path);
    await history.service.openProject(repos[1].path);
    await Promise.all([history.service.openProject(repos[2].path), history.service.removeRecentProject(repos[0].path)]);
    assert.deepEqual((await history.service.getRecentProjects()).projects.map(project => project.path), [repos[2].path, repos[1].path]);
    const operations = [history.service.removeRecentProject(repos[1].path), history.service.clearRecentProjects()];
    await Promise.all(operations);
    assert.deepEqual((await history.service.getRecentProjects()).projects, []);
  } finally { await Promise.all(repos.map(repo => repo.cleanup())); await history.cleanup(); }
});
