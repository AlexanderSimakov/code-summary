# Code Summary design

This document records agreed decisions from the design interview. The first milestone and testing approach are confirmed and published in [GitHub issue #1](https://github.com/AlexanderSimakov/code-summary/issues/1), labeled `ready-for-agent`. Use that issue as the implementation specification; this document preserves the design context.

## Purpose

A personal experiment for a developer who wants to understand source code and review changes through plain-English explanations. The first version prioritizes reviewing changes, with browsing unchanged code available for context.

## Agreed behavior

- The app runs locally with a browser interface. The first milestone is read-only. Bidirectional editing (English edits modifying source and source edits updating English) is a subsequent milestone, after the explanation and diff workflow is proven.
- The user opens a local Git repository.
- The initial comparison is current files against HEAD, combining staged and unstaged changes.
- Initial language support is JavaScript and TypeScript. Additional languages are an intended extension.
- Function names remain exactly as written in source.
- A function explanation contains several statements. Each statement describes behavior across source lines and links back to those lines.
- Explanations describe conditions, side effects, and failure behavior where relevant.
- Unchanged statements retain their wording. Changes appear as added, removed, or modified statements.
- Source changes that appear to preserve behavior are marked “Source changed; no behavior change identified.” This is an AI assessment, not a proof of equivalence.
- Source code and source diffs remain accessible from the English view.
- The reading layout places English on the left and source on the right, with linked selections.
- The source pane normally shows current source, with a toggle to the Git diff against HEAD. Selecting a removed statement reveals its previous source.
- The app may read relevant definitions from other files to explain behavior. Explanations must flag uncertainty when available context is insufficient.
- Untracked files appear as additions, deleted files as removals, and Git-ignored files are excluded.
- External file edits mark existing explanations as outdated. The current review stays visible until the user requests a refresh.
- Explanations also cover module-level behavior and changed classes, types, and constants.
- Explanations are generated when a changed file is opened, then cached and reused until its source changes.
- The user provides an OpenRouter API key and accepts sending relevant source to models through OpenRouter. Git access and saved explanations remain local.
- The model is selectable in settings, with a default model for the experiment. Generation happens on request; cached explanations make no AI request.
- Failed generation or invalid source links leave source accessible, with an explanation error and retry action. Previous explanations may remain visible when clearly marked outdated.
- Analysis starts with the full changed function and relevant definitions, expanding context within a configurable limit. Missing context that limits reliability is flagged.
- Before generation, the app shows which files will be sent. The user can cancel pending work and inspect token usage and cost when reported by OpenRouter.

## Repository navigation

The sidebar presents the Git-visible files as a tree matching their relative directory paths. Ignore Git-ignored files and empty directories; include untracked additions and deleted files at their previous paths. Folders are collapsible, with the first directory level expanded initially and deeper folders collapsed. Within each folder, sort directories first, then files, alphabetically. Clicking a folder toggles expansion; clicking a file opens its review. Changed files retain status indicators, and each folder shows its descendant changed-file count even when collapsed.

## Technical direction

- TypeScript throughout, React and Vite for the browser interface, and a local Node.js server for filesystem access, Git, caching, and OpenRouter requests.
- Keep the OpenRouter API key in the local server, outside frontend bundles.
- Start with the TypeScript parser for TS/JS source spans, behind a replaceable language adapter. Pin its version to isolate API changes. Additional languages require their own extraction rules.
- Preserve exact source identifiers; in particular, use original function names as headings.
- Validate generated structure and source references locally. Valid references establish traceability, not explanation accuracy.
- Treat stable matching of statements between source versions as a prototype risk to evaluate, rather than assuming AI output is deterministic.
- Inspect the target repository without executing its code.

The core flow is: select repository, inspect Git changes, select a file, preview files to be sent, request or reuse explanations, review English statements, and select a statement to inspect its source or diff.

Selecting a changed file prepares analysis; sending source requires an explicit generation request. Browsing unchanged files can generate baseline explanations through the same flow.

## First milestone validation

Use `/Users/alexandersim/Projects/train-parser/trains` as the experimental repository. Validate behavior changes, refactors, added and deleted functions, and module-level changes. Check explanation accuracy manually, source link correctness, and cache reuse without new AI requests. Repository inspection is read-only; any missing test scenarios should be constructed in a separate fixture rather than modifying the experimental repository.

Inspection found that this path is its own Git root on `master`, with a clean working tree. It has 22 TypeScript source files, two JavaScript test files, and a Python script. TS/JS is supported initially; the Python script remains outside explanation support for the first milestone. The clean working tree means the initial change list will be empty.

Useful evaluation files include `src/trackingConfig.ts` for validation and persistence, `src/trainTracker.ts` for cross-file calls, `src/monitor.ts` for asynchronous behavior, and `src/types.ts` for declarations.

## Subsequent milestone

Bidirectional editing: editing English proposes source changes, and source edits update explanations. The application and review rules for these changes will be designed after statement mapping and English diffs have been evaluated. Editing is outside the first milestone.

## Implementation details to resolve during the prototype

Model choice, context-limit defaults, cache representation, statement matching, and handling oversized files. These must preserve explicit generation, visible uncertainty, stable unchanged statements, and accessible source when explanations fail.
