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

Integration tests exercise the public `ReviewService` with real temporary Git repositories. The browser smoke opens a repository, selects source, toggles its diff, and checks recovery from an invalid path. All tests use separate fixtures, without modifying the experimental repository.
