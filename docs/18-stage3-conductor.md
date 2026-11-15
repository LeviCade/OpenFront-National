# 18 — Stage 3 conductor protocol and three-engineer ownership

**Status:** Stage 2 accepted. Stage 3 implementation authorized.
**Integration policy:** one authoritative simulation and one integrated game,
never three mutually incompatible isolated features.

## Entry condition

Use the merged main tree and
[Stage 2 acceptance](17-stage2-acceptance.md).
Review [AGENTS.md](../AGENTS.md),
[decision register](11-decisions.md),
[scenario matrix](10-scenarios.md), and [roadmap](14-roadmap.md).
The source is a running upstream baseline, **not an implemented NATIONAL**.

## Shared rules

- NATIONAL is an opt-in Solo FFA ruleset above Impossible. Legacy game
  modes, replay data and difficulty semantics must not regress.
- The last independent sovereign or one empire wins. No land-percentage
  or hard-time shortcut for NATIONAL victory.
- No AI human-target bias, cheating, privileged visibility, resource
  duplication, hidden treaty leakage or unauthorized diplomacy.
- Empire-wide and individual national war records are separate and can
  overlap; ending one cannot erase an independent other.
- Determinism must hold across snapshot/save/load/replay and simulation
  tick ordering. Tests must use named scenario IDs.
- Deferred currencies, goods, loans, collateral and new economics are
  **out of scope** for the initial NATIONAL release.

## Conductor — shared contracts, integration, release

The conductor alone coordinates central shared files: game configuration,
wire types/schemas, authoritative game loop/state, execution routing,
serialization, victory routing, CI, integration branches, and release gates.
No engineer may independently redefine PoliticalIdentity, Coalition,
WarRecord, diplomacy command schemas, or snapshot layout.

**First deliverable M0:** isolated NATIONAL feature flag, single authoritative
political identity model and new NATIONAL command routing contract;
deterministic seeded scenario harness; baseline tests for old modes;
a written and testable interface for each engineering subsystem.
No AI-only facade is an acceptable substitute for integrated behavior.

Engineering branch policy after M0 integration:

- Integration: \`stage3/integration-20261115\`.
- Engineer 1: \`stage3/engineer-1-politics-20261115\`.
- Engineer 2: \`stage3/engineer-2-conflict-20261115\`.
- Engineer 3: \`stage3/engineer-3-intelligence-20261115\`.

All engineers start from the same conductor-approved integration SHA and
submit small PRs targeting integration, not ad hoc direct commits to main.
Conductor rebases/reconciles overlapping files, executes complete CI,
and merges tested slices to main when coherent. No blind PR auto-merges.

## Engineer 1 — sovereignty, coalitions and empire law

Own independent vs imperial sovereignty and exclusive empire membership;
NAP/MDA constitutional politics, admissions, unanimity, betrayal,
leadership, transfer, Ungovernable crisis and collapse; later treasury,
construction authority and three imperial military modes.
Tests: SOV-01..07, COAL-01..07 and relevant D-003..D-013.
Prefer new modules in \`packages/engine/src/national/politics/\`
and scoped tests. Shared engine API changes require a conductor contract PR.

## Engineer 2 — war/peace, combat and coercion

Own formal and layered national/empire wars, peace authorization,
in-flight combat semantics, instantaneous **real troop** defensive levies,
campaign anti-abuse accounting, embargoes, secondary sanctions,
coercive ultimatums and wartime naval blockades.
Tests: WAR-01..12, LEVY-01..07, ECON-01..08, NAV-01..05.
Prefer new modules in \`packages/engine/src/national/conflict/\`.
Prove troop/gold conservation, no single-action replay double spend,
effective hostility derivation, and correct peace-layer survival.

## Engineer 3 — fair AI, observation and intelligence

Own the NATIONAL national-interest planner, strategic objectives and
credibility memory, legitimate observation and fog rights, emperor shared
intelligence, intelligence costs, and bounded AI update cadence.
Tests: AI-01..07 and FOG-01..07; same observations for AI and human.
Prefer new modules in \`packages/engine/src/national/ai/\` and
\`packages/engine/src/national/observation/\`. Do not implement omniscient
global-state reads, implicit human bias or independent command legality.

## Mandatory PR contract

Every PR cites concrete D-IDs and scenario IDs, the base integration SHA,
affected authoritative state transitions, snapshot/replay implications,
compatibility and CPU/heap implications. Include unit and integrated tests;
provide exact GitHub Actions run URL and test results; call out open design
items explicitly rather than inventing user decisions.

Critical invariants are release blockers: no hidden visibility leaks,
no phantom troops/gold, no double levy charge, no illegal diplomatic
actions, no erasure of surviving war records, and no old-mode regressions.
For production, also resolve [asset audit #5](https://github.com/LeviCade/OpenFront-National/issues/5)
and [dependency security #6](https://github.com/LeviCade/OpenFront-National/issues/6).

## First implementation wave

1. Conductor commits M0 contracts and a runnable NATIONAL flag.
2. Engineer 1 ships sovereign identity and last-sovereign victory tests.
3. Engineer 2 ships minimal formal war record and permission tests.
4. Engineer 3 ships the observation API and human-neutral planner scaffolding.
5. Conductor integrates, runs full deterministic/replay and legacy checks,
   and then expands each engineer to their next subsystem slice.

**The objective is one working game, not three disconnected green PRs.**
