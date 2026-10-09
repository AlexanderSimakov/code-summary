# Code Summary

A local browser interface for reviewing a Git working tree. Generate plain-English function explanations on the left and inspect their linked source on the right. Source browsing works without AI configuration.

## Run

Use Node.js 22.12 or newer (Node.js 24 recommended).

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173 and enter a local repository path. The backend listens only on 127.0.0.1:4310. To serve a built interface instead:

```sh
npm run build
npm start
```

Open http://127.0.0.1:4310. Run from this project's root directory.

## Review

The file list includes tracked files and non-ignored untracked files. Changes compare working-tree content against HEAD, combining staged and unstaged edits. Deleted source remains available as previous source. A clean repository supports browsing too. Symlinks display their target paths without reading their targets. Binary files and files over 2 MiB do not display source text. Additional languages remain browsable as text but are unsupported for explanations.

Inspection does not execute the target repository, its scripts, tests, hooks, diff helpers, or text converters, and does not modify its contents or Git index. Renames are currently presented as a deletion and an addition. Repositories without commits are browsable as additions. Explanations currently cover named TS/JS functions and methods; English comparisons, module declarations, cross-file context, caching, cancellation and usage controls arrive in subsequent slices.

## Recent projects

The last 10 successfully opened Git repositories appear below the repository-path field, newest first. Click a project to load its current files and Git state with a fresh file selection. Startup shows the list without opening a repository automatically. Opening a project makes no AI request; compatible explanations are restored through the existing cache workflow when you select a file.

History is shared by browsers using the same local server and survives restarts. It is stored in `~/.code-summary/recent-projects.json`, outside reviewed repositories and the temporary explanation cache. Set `CODE_SUMMARY_DATA_DIR` on the server to choose a different application-owned storage directory. Subfolders and symlinks resolve to the repository root; separate Git worktrees remain separate entries.

**Remove** forgets one shortcut and **Clear history** forgets the list. Neither changes repository files or cached explanations. Unavailable repositories stay listed after a failed reopen, and your current review remains visible. History errors show a warning while repository browsing stays available. Lists refresh on load, tab focus, and explicit history actions without background polling.

## OpenRouter explanations

Copy `.env.example` to `.env` in this application directory, set `OPENROUTER_API_KEY` locally, and restart the server. Never paste your key into the browser, target repository, or chat. `.env` is ignored by Git and loaded only on the server. `OPENROUTER_MODEL` defaults to `openai/gpt-4.1-mini`; the browser model field can select another model supporting structured output.

Select a TS/JS file, choose **Preview transmission**, inspect the complete source shown, then choose **Generate explanations**. Opening files and preparing previews make no provider requests. Clicking a statement highlights its source lines; deleted files use previous source. A source change after preview requires a new preview. Authentication, provider, and invalid-output errors leave source accessible and offer explicit retry. AI-generated descriptions and valid source links still require your judgment about accuracy. No live quality evaluation is claimed until a key is configured and actual calls are made.

For isolated development/test instances set `E2E_PORT` (Vite/browser, default 5173) and `API_PORT` (backend, default 4310). Strict ports and disabled server reuse prevent browser tests from attaching to another worktree.

## Verify

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Integration tests exercise the public `ReviewService` with real temporary Git repositories. The browser smoke opens a repository, selects source, toggles its diff, and checks recovery from an invalid path. All tests use separate fixtures and isolated history/cache directories, without modifying the experimental repository or your saved recent projects. Recent-project browser checks use isolated local HTTP servers with real temporary Git repositories, including multiple browser contexts.

## Cached reviews and external edits

Compatible explanations are restored locally when opening a file, including after restarting the server. Cache identity includes the repository, immutable source version, relevant dependency snapshots and missing-context warnings, model, context limit, and parser/prompt/schema revision. Cache hits make no OpenRouter request. Usage shown for a cached explanation is its original reported generation usage, not a new charge.

The cache lives outside inspected repositories in the operating system temporary directory under a per-user Code Summary cache folder, with restricted directory/file permissions. Set `CODE_SUMMARY_CACHE_DIR` on the local server for a different persistent application-owned directory. Temporary-directory cleanup may remove cached results; malformed or missing cache entries become misses. Cached files contain reviewed source and explanations, never API credentials.

The browser checks for local source and relevant context edits periodically without contacting OpenRouter. An outdated review retains its English and source snapshots. Choose **Refresh review** to load current source; compatible cached results return locally, while misses require a fresh transmission preview and explicit generation. New resolutions of previously missing imports invalidate the prior review too. Results completed during an external edit remain attached to their approved snapshot and become outdated rather than being mapped onto the new code.
