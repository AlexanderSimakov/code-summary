# Domain Docs

This repo uses a single-context layout: `GLOSSARY.md` at the repo root and `docs/adr/` for architecture decision records.

## Before exploring

Read `GLOSSARY.md` and any ADRs in `docs/adr/` that touch the area you are about to work in.

If these files do not exist, proceed silently. Domain documentation is created lazily by the `domain-modeling` skill when terms or decisions are resolved.

## Use the glossary's vocabulary

When naming a domain concept in an issue, proposal, hypothesis, or test, use the term defined in `GLOSSARY.md`. If a term is missing, reconsider whether it belongs in the project or note the gap for `domain-modeling`.

## Flag ADR conflicts

If a proposal contradicts an existing ADR, identify the ADR and explain why the decision should be reconsidered.
