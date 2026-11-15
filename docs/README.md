# NATIONAL design library

**Status: Stage 1 / design documentation, not implemented code.** The documents below capture the intended NATIONAL ruleset. Their requirements are the target for Stage 3, not claims about what current OpenFront supports.

## Navigation

| Order | Specification | Why it matters |
| --- | --- | --- |
| 00 | [Vision](00-vision.md) | First principles and limits |
| 01 | [Difficulty and victory](01-victory-and-difficulty.md) | What winning actually means |
| 02 | [National AI](02-national-ai.md) | Independent planning and fair information |
| 03 | [Coalitions](03-coalitions.md) | Constitutional NAPs and defense treaties |
| 04 | [Empires](04-empires.md) | Supreme leadership and constituent states |
| 05 | [War and peace](05-war-and-peace.md) | Formal layered conflict |
| 06 | [Sanctions and blockades](06-sanctions-and-blockades.md) | Economic coercion, piracy, ultimata |
| 07 | [Intelligence](07-intelligence.md) | Fog, visibility, information sharing |
| 08 | [Experience](08-experience.md) | UI and feedback |
| 09 | [Engineering](09-engineering-constraints.md) | Determinism, performance, data model |
| 10 | [Scenarios](10-scenarios.md) | Automated test acceptance |
| 11 | [Decision register](11-decisions.md) | Resolved intent, open implementation questions |
| 12 | [Deferred economics](12-deferred-economics.md) | Explicitly excluded financial redesign |
| 13 | [Migration](13-migration-plan.md) | Stage 2 upstream sourcing and licensing |
| 14 | [Roadmap](14-roadmap.md) | Stage 3 delivery sequencing |
| — | [Glossary](GLOSSARY.md) | Consistent technical vocabulary |

## Status language

- **CORE RULE**: agreed product direction. Do not silently invert it.
- **RECOMMENDED DEFAULT**: suggested initial policy or numeric value; tune with simulations.
- **OPEN**: needs a written decision before dependent implementation.
- **DEFERRED**: not part of NATIONAL initial release.
- **UPSTREAM CURRENT**: behavior observed in OpenFront, not NATIONAL.

In case of conflicting older discussion, the detailed documents and [decision register](11-decisions.md) reflect the *latest* agreed vision. Treat this repository as an independent proposed project; coordinate design changes via pull requests and scenario tests.

## Design PR checklist

Every meaningful proposal should state (1) why a self-interested nation would use it, (2) the exact authoritative state transition, (3) enforcement and failure rules, (4) effect on empires and overlapping coalitions, (5) what human and AI can know, (6) anti-abuse invariants, and (7) at least one automated scenario.

**Do not start Stage 2 migration or Stage 3 coding in a Stage 1 documentation change.**
