# English comparison limitations

English comparisons retain HEAD and current explanations with source-version-specific references. Selecting a removed statement opens previous source; the Git diff remains available regardless of the model assessment.

Matching is deliberately heuristic. Uniquely named functions are paired by exact name. Duplicate names across scopes are shown as removals/additions rather than guessed. Renamed functions are also shown as removals/additions.

Within matched functions, identical referenced source fragments retain their previous wording only when the whole enclosing function and supplied dependency contents are unchanged. This avoids overriding a correct new explanation when an unchanged call gains a different condition or its dependency changes. Rephrasing within a changed function can therefore still appear as a change; inspect the source when that happens.

Identical statement text is treated as an apparent unchanged behavior, even for changed source. This is an AI assessment, not semantic equivalence. Remaining statements are paired in order as modified; insertions, deletions and reordered behavior can make those pairings imperfect. Remaining unmatched statements are additions or removals. Split/merged statements can also create noise.

“Source changed; no behavior change identified” appears only when all matched statements are unchanged and source differs. It never hides the source diff or establishes that the change is safe. Source references and structured output validation establish correspondence, not explanation accuracy.
