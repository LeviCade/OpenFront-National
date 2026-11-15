# Contributing to OpenFront: NATIONAL

NATIONAL is an **independent proposed OpenFront expansion**, currently in **Stage 1: vision documentation**. It is not the official upstream OpenFront project.

## Three-stage development discipline

1. **Stage 1: Vision.** Review and improve product rules, edge cases, architecture and test scenarios. **Do not import or implement the game engine during this stage.**
2. **Stage 2: Migration.** Import upstream code with full provenance, appropriate license/asset notices, reproducible baseline tests and a synchronization plan.
3. **Stage 3: Coding.** Implement approved mechanical slices against the migrated baseline with deterministic tests and performance checks.

## How to propose a design change

Read [docs/README.md](docs/README.md), [docs/00-vision.md](docs/00-vision.md), [docs/11-decisions.md](docs/11-decisions.md), and [docs/10-scenarios.md](docs/10-scenarios.md). State the problem, why this helps a rational self-interested nation pursue victory, who has authority, what exact action changes game state, what enforcement applies, how it handles imperial and coalition cases, what information is visible, and which tests prove it.

When you change a CORE rule, update its decision-register entry and all affected cross-references in the same PR. Keep new economic mechanics out of NATIONAL unless the scope is formally revised.

## Coding principles (Stage 3)

- Human and AI operate under the same information and game rules.
- No artificial anti-human, anti-leader or special-team aggression.
- Never clone or lose troops/gold on transitions.
- Distinguish national-war records from empire-wide-war records.
- Preserve deterministic replays and stable client/server semantics.
- Maintain real-world-scale performance for many nations and a large map.
- Preserve existing OpenFront gameplay in legacy modes.
- Test end-to-end integrated slices, not only isolated functions.
- Follow upstream's verified current install and CI workflow after migration.

## Licensing and attribution

Upstream OpenFront code uses GNU AGPL v3; upstream assets use separate licensing and notices. No upstream game source or assets are present in this Stage 1 documentation-only repository. Stage 2 contributors must follow [docs/13-migration-plan.md](docs/13-migration-plan.md), maintain applicable notices and honor upstream licensing.

Submit focused PRs; do not claim official upstream endorsement or full feature implementation merely from a design document.
