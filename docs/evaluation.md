# Read-only milestone evaluation

Evaluated on 2026-10-09 for spec #1 and ticket #9. The integrated application works as a local TS/JS review experiment. Source-reference validation checks structural correspondence, not the truth of the English explanation. The live results below demonstrate useful granularity and also concrete remaining accuracy limitations.

## Deterministic verification

The approved primary seam is the public ReviewService, with real temporary Git repositories and the real TypeScript parser; only the external AI transport is controlled. Browser tests exercise the local application with controlled explanation responses. Neither suite calls a paid provider.

- `npm test`: 32 tests passed.
- `npm run test:e2e`: 9 browser tests passed using a separate local server and Chromium.
- `npm run build`: type checking and production build passed.

| Scenario | Evidence |
| --- | --- |
| Clean repositories, browsing, invalid paths | Service fixtures and browser clean/error states |
| Combined staged/unstaged changes, untracked additions, deletion, ignores | Real temporary Git fixtures; original content and Git state checked |
| Function names, methods, anonymous units, types, constants, classes, module execution | Parser-backed service tests and declaration browser test |
| Behavior changes, refactors, added/deleted functions, stable wording | Separate comparison fixtures; previous/current references and visible source diff |
| Cross-file behavior and bounded context | Public preview/generation; unresolved imports and excluded context; dependency-only behavior change with unchanged reviewed function |
| Cache, restart, context/model/config changes | Service reuse/invalidation tests; browser restores cached review without explicit generation |
| External edits, retained snapshot, refresh | Service freshness/in-flight tests; browser explicit refresh |
| Cancellation, late completion, retries, missing/actual usage | Controlled transport tests and browser failure/cancel/retry coverage |
| Invalid references | Out-of-range and renamed-name rejection; brace-only evidence regression reproduced red, then fixed and verified green |
| Desktop navigation | Long-review browser regression reproduced scrolling loss and outdated pane displacement, then passed after independent pane scrolling and a full-width outdated banner |

Matching remains heuristic: same-source/same-context fragments preserve wording, identical text may match after edits, and remaining statements pair by order. This can mispair reordered or duplicated behavior and cannot prove equivalence. Refactor assessments remain explicitly qualified. Dependency-only edits are tested even when the selected function's text is unchanged.

## Live OpenRouter evaluation

The experimental repository was inspected read-only at `/Users/alexandersim/Projects/train-parser/trains`. No project code or tests were executed. Its HEAD before and after inspection was `e2dce46759906272a3373bccac07b034420a764f`; `git status --porcelain=v1` was empty before and after. Missing change scenarios were tested in separate temporary fixtures, never by editing this repository.

Before each generation the service prepared a transmission preview: only current `src/trackingConfig.ts`, 5,986 UTF-8 source bytes, 20 source units. The model was the configured default `openai/gpt-4.1-mini`, using the user's key loaded server-side from their local environment file. The external `fs` and `path` implementations were unavailable and appeared as context warnings. Source byte counts are not token counts or serialized request sizes; the final request presented the same approved content with explicit line numbers.

There were three successful paid generation requests, no automatic application retries, and one initial network-blocked attempt before enabling network access. The blocked attempt returned no provider usage. Successful usage was reported by OpenRouter:

| Request | Prompt tokens | Completion tokens | Total tokens | Cost (credits) | Statements |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original prompt | 2,576 | 1,557 | 4,133 | 0.0035216 | 20 |
| Explicit behavior granularity | 2,690 | 1,769 | 4,459 | 0.0039064 | 36 |
| Numbered source and runtime-check guidance | 3,634 | 2,320 | 5,954 | 0.0051656 | 56 |
| Total reported | 8,900 | 5,646 | 14,546 | 0.0125936 | — |

All three results passed the then-current schema/name/range checks. The first result collapsed complex methods into single paragraphs. The second split behaviors but exposed inaccurate in-range references: the in-memory assignment in `save` cited closing line 114 rather than operation line 113, and selection construction in `load` cited closing lines 99–100 rather than 93–97. The final prompt supplies numbered lines, explicitly requests narrow supporting ranges, and distinguishes runtime checks from optional type annotations. A new service rule rejects references containing only whitespace and structural delimiters. The cache generation revision changed with these prompt changes.

Manual inspection of the final result against actual source confirmed:

- `normalizeUrl` separates parsing, protocol rejection, hostname rejection, date validation, and the normalized return, with useful supporting ranges.
- `save` separates serialization, directory creation, temporary-file writing, renaming, and the in-memory update. The update now correctly links to line 113 and states it follows both write and rename.
- `load` now links selection construction to lines 93–97 and describes the null-or-array requirement for `trackedTrains`, rather than incorrectly allowing omission.
- Names were preserved and all references remained attached to the analyzed current-source hash. Context warnings were visible rather than suppressed.

Remaining semantic problems are real: the hostname statement uses ambiguous “not ... or does not ...” wording for a source rejection condition using `&&`; a type assertion in `load` is described as extracting properties even though it has no runtime effect; serialization calls its parameter “in-memory data”; atomic-persistence wording should still be treated cautiously. Missing-context warnings do not identify all such model errors. The final output is an experiment to verify alongside source, not a trustworthy substitute for code review. Numbered lines and brace-only rejection improve source correspondence without establishing semantic correctness or ruling out other wrong in-range links.

Live coverage was one representative, unchanged TS file containing complex functions, a class, types, and imports. No claim is made of live JS quality, live before/after/refactor matching, whole-repository accuracy, or cross-file live quality. Those behaviors have deterministic fixture coverage; broader live evaluation is follow-up work.

## Cache and visual inspection

Each paid request used an isolated application cache outside the target repository. After each result, reopening compatible analysis restored it with `cached: true` and the controlled external-transport counter stayed at one. Final browser inspection restored the final result from that same cache without pressing Generate or making another paid request. After separating global context warnings from statement-local uncertainty, the already paid output was revalidated offline into the new cache revision, removing only the exact server-appended warning suffix and preserving the original model text, ranges, and reported usage. No API credentials or provider request were used for that revalidation.

A 1600 × 1100 screenshot is available as `/private/tmp/code-summary-implementation/review.png` in this session. It shows English statements on the left, current source on the right, and the selected parsing statement highlighting source lines 36–37. Visual inspection confirmed the selected statement stays visible while source scrolls independently, and the original header and source toggles remain accessible. The screenshot contains experimental source and is not committed to the project. Global context warnings now appear once near the review header for each source side, while model-specific uncertainty stays attached to its statement. A service regression checks that separation, and the browser checks a single shared warning plus distinct local uncertainty. The sidebar still lists all repository files, including non-source files.

## Scope and follow-up

The milestone remains read-only and limited to TS/JS explanations. Python and other unsupported files remain browseable where source text is available. No Git write, target-code execution, in-app source editor, English editor, or bidirectional transformation was added. Follow up with broader manual quality/matching evaluation and clearer uncertainty presentation before the separately agreed milestone for English-to-source and source-to-English editing.
