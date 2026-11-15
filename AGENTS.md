# Instructions for coding agents and future engineer/conductor sessions

## Current stage

**Stage 1 — VISION COMPLETE. Stage 2 — MIGRATION ACTIVE ON SEPARATE BRANCH, NOT YET ACCEPTED.** First read [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md) and verify the live GitHub Actions result and branch state. The default branch may intentionally contain only the documentation baseline until Stage 2 import and tests pass. Never overwrite the vision or treat source import as completion. Do not implement NATIONAL mechanics (Stage 3) until Stage 2 baseline is verified.

## Authoritative documentation

Start with [README.md](README.md), [docs/README.md](docs/README.md), [docs/00-vision.md](docs/00-vision.md), [docs/11-decisions.md](docs/11-decisions.md), [docs/10-scenarios.md](docs/10-scenarios.md) and [docs/14-roadmap.md](docs/14-roadmap.md). The later discussion supersedes earlier brainstorms and the decision register tracks the agreed product direction.

## Core rules to preserve

- AI and humans have equal mechanics and visibility; every nation pursues victory, not balancing.
- NATIONAL is an opt-in Solo FFA ruleset above Impossible, not automatic replacement for existing modes.
- Exactly one independent nation or one empire must remain for victory.
- Independent NAP/MDA membership may overlap; Betray enables unconditional sovereign exit and automatic expulsion.
- Empire membership is exclusive and does not allow unilateral exit. One supreme leader may delegate member-specific foreign diplomacy.
- National and empire-wide wars are separate records. Empire-wide peace **never erases** surviving individual member wars.
- Defensive levies use real troops only, before land loss, with budgets preventing repeated attack-click exploitation.
- Peacetime embargo exists; piracy requires war; neutral maritime-blockade targets are turned home without capture or trade revenue.
- Treaty details and unseen enemy state are protected by true visibility filtering; empire intelligence is shared.
- Do not add currencies, goods, debts, notes, collateral, pricing reform or other deferred economy work to initial NATIONAL.

## Work protocol

Document current branch, SHA, exact files and baseline before changing them. Changes must be scoped, atomic, reviewed against the decision register, and tested using scenario IDs. Before claiming completeness, prove deterministic serialization/replay, legality of troop/gold accounting, cross-mode non-regression and whole-game integration.

**No hidden changes to Stage 1 design, no unexplained priority inversion, and no pretending that a proposed rule is implemented.**

## Source relationship

Upstream https://github.com/openfrontio/OpenFrontIO — independently licensed source and assets with mandatory notices. See [docs/13-migration-plan.md](docs/13-migration-plan.md). This repository is not an official OpenFront branch or approved upstream release.
