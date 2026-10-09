# Code Summary

A local browser interface for reviewing a Git working tree. English explanations are added in the next implementation slice; source browsing works without AI configuration.

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

Inspection does not execute the target repository, its scripts, tests, hooks, diff helpers, or text converters, and does not modify its contents or Git index. Renames are currently presented as a deletion and an addition. Repositories without commits are browsable as additions. OpenRouter integration is outside this slice.

## Verify

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Integration tests exercise the public `ReviewService` with real temporary Git repositories. The browser smoke opens a repository, selects source, toggles its diff, and checks recovery from an invalid path. All tests use separate fixtures, without modifying the experimental repository.
