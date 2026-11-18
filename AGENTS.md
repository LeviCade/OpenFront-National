# Instructions for coding agents and future engineer/conductor sessions

## Owner compute policy — November 17, 2026

This repository is PUBLIC. Keep workloads supported by standard free GitHub-hosted runners on GitHub-hosted compute. A specialized job may use owner-operated Skybot only when the free hosted offering cannot satisfy its required capability/resource class and the exact public repository has an explicitly configured, accepted Skybot profile.

- The existing national-hardware-acceptance.yml is a manual-only specialized GPU workload. Its self-hosted gpu label does NOT mean a Skybot GPU runner is currently registered or that hardware acceptance has passed.
- Keep normal public CI on GitHub-hosted runners. Do not move the whole repository to Skybot.
- Do not dispatch or enable the GPU job on Skybot until Skybot-CI issues #238 and #239 pass: exact-repository public admission, actual GPU acceleration, and arbitrary public/fork-code host/LAN isolation.
- Public repositories are never dynamically auto-onboarded by the private-repository scanner. Never use the persistent skybot-ci-dev runner, host mounts, host sockets, controller credentials, signing keys or private secrets for public code.
- GitHub Actions does not automatically transfer a queued/failed hosted job to Skybot; specialized Skybot jobs must explicitly select their approved capability label.
- If this repository becomes PRIVATE, all its GitHub Actions jobs must move to owner-operated Skybot compute only.

Canonical policy: https://github.com/LeviCade/Skybot-CI/blob/main/docs/PRIVATE_PUBLIC_CI_POLICY.md
Runner guide: https://github.com/LeviCade/Skybot-CI/blob/main/docs/CI_RUNNER_CHOICES.md
Implementation gates: https://github.com/LeviCade/Skybot-CI/issues/238 and https://github.com/LeviCade/Skybot-CI/issues/239.

## Current stage

**Stage 1 — VISION COMPLETE. Stage 2 — SOURCE MIGRATION ACCEPTED AND MERGED. Stage 3 — AUTHORIZED, NOT YET IMPLEMENTED.** Read [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md), [docs/17-stage2-acceptance.md](docs/17-stage2-acceptance.md), and [docs/18-stage3-conductor.md](docs/18-stage3-conductor.md) before changing implementation. Use the verified merged source on main. Preserve the vision, upstream notices, original NATIONAL asset replacements, and legacy behavior. Do not ship publicly until remaining pre-release checks are resolved.

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
