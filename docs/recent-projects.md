# Recent projects

The design and testing approach are confirmed and published in [spec #11](https://github.com/AlexanderSimakov/code-summary/issues/11), labeled `ready-for-agent`. Use that issue as the implementation specification; this document preserves the design context.

- A recent project is a local Git repository that opened successfully. Failed attempts do not enter history.
- Show a compact Recent projects list below the repository-path field, both before and after opening a project.
- Each entry shows the repository name and full path to distinguish similarly named folders.
- Remember history locally on this computer across refreshes and app restarts, shared by browsers using the same local app.
- Clicking an entry immediately opens the repository with its current files and Git state. File selection starts fresh; compatible explanations use the existing cache workflow.

- Keep the 10 most recently opened projects, newest first. A successful explicit open moves a project to the top; background reads and refreshes do not reorder history.
- Offer Remove for individual entries and Clear history for the list. Forgetting history does not delete repository files or cached explanations.
- Failed reopening retains the entry and the current review, shows an error, and allows retry or removal.
- Startup shows recent projects without automatically opening a repository.

- Identify entries by the resolved Git repository root. Subfolders and symlink aliases converge on one entry; separate Git worktrees remain distinct.
- History failures do not block repository browsing. Show a small warning on read/write failure, recover malformed history as an empty list, and report when an opened project cannot be saved.
- Refresh history on app load, tab focus, and explicit open/remove/clear actions. No continuous polling. Updates preserve unrelated entries added by another browser tab.

## Implementation direction

Persist history in a durable per-user application file outside reviewed repositories and version control. The existing explanation cache uses temporary storage and is not suitable for this history. Use atomic file replacement and serialize mutations in the local server so browser updates do not overwrite unrelated entries.

Only successful explicit opens update recency. Internal repository reads for source, analysis, and freshness checks must not add or reorder entries. Reopening uses the existing repository-open flow and makes no automatic AI generation request. Removed or cleared entries can be added again by a later successful explicit open.

## Verification

- Service checks cover persistence across restart, newest-first ordering, the 10-entry limit, canonical-path deduplication, and distinct worktrees.
- Check that failed opens and background reads do not change recency; removal and clearing leave repository contents and cached explanations intact.
- Exercise malformed history, unavailable storage, and concurrent mutations from different clients.
- Browser checks cover the list before and after opening a project, one-click reopening with fresh file selection, failed reopening retaining the current review, removal/clearing, focus refresh, and non-blocking history warnings.
