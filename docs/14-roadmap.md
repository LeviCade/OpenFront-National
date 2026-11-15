# 14 — Three-stage roadmap and Stage 3 workstreams

## Stage 1 — The Vision (current)

**Deliverable:** Public repository contains complete, internally consistent design docs, source attribution and migration strategy, precise acceptance scenarios, decision register, and contributor/agent instructions.

Success requires every proposed core subsystem represented in written source of truth; outstanding numerical or engine detail explicitly marked OPEN; deferred economy outside scope. No game coding or source migration yet.

## Stage 2 — The Migration (next)

**Deliverable:** Reproducible, legally attributed upstream OpenFront source baseline in this independent repository.

- Pin exact upstream snapshot and code/asset licenses.
- Import with history/provenance consideration, preserve Stage 1 docs.
- Run upstream baseline CI, install, build and game smoke.
- Establish upstream sync strategy and comparison baseline.
- Record pass/fail evidence. No code changes for NATIONAL features yet.

Go/no-go: complete baseline acceptance per [migration plan](13-migration-plan.md).

## Stage 3 — The Coding (after successful migration)

Feature work should proceed as vertical slices that keep real gameplay working at each milestone. Proposed sequencing:

### M0 — Mode isolation and test harness

Feature gate NATIONAL in Solo FFA; add deterministic fixture scenarios, replay checks and unobtrusive UI scaffolding. Existing modes remain unchanged.

### M1 — Sovereignty and victory

Represent independent nations, empires, member status, emperor transfer and collapse; enforce last-sovereign-standing victory and prestige labels.

### M2 — Constitutional treaty engine

NAP/MDA records, membership, leadership powers, admission votes, unanimous amendments, Betray and automatic expulsion, secrecy, alliance replacement within NATIONAL.

### M3 — War, peace and scope

National/empire-wide war records, delegated diplomacy, layered peace, war permission for combat, peacetime embargo, existing-in-flight attack semantics.

### M4 — Mutual defensive levy

Attack interception before tile loss, weighted caps/protected reserves, real troop deduction/returns, campaign-spam protection and simultaneous allocation.

### M5 — Imperial administration

Exclusive membership, standing response policy, central/hybrid/decentralized armies, population-cap redistribution, treasury routing, member construction authority, trade overrides, Ungovernable crisis and Imperial Transfer.

### M6 — Economic coercion and maritime enforcement

Secondary sanctions, refusal/compliance and enforcement, credible ultimatums, proxy wars, physically enforceable naval blockades and neutral merchant return.

### M7 — Fog and intelligence

Public vs hidden nation observations, border/coast/ship visibility, secret treaty terms, empire-shared reconnaissance, funded regional/national/global intelligence, no client leaks.

### M8 — Unified NATIONAL strategic AI

Self-interested objectives and persistent memory, no human bias, imperial decisions, betrayal, credible threats, limited-information inference. It may help build scaffolding early but must be integrated against actual earlier mechanics.

### M9 — World simulation, UX polish and release

Coalition/empire panels, clear war badges, notifications, accessibility, complete scenario suite, multiplayer/legacy regression, CPU/memory benchmarks and anti-abuse fuzzing.

## Cross-cutting engineering ownership

Parallel implementation must assign one owner of **political/sovereign state model and migrations**, one owner of **war/combat/levy resource accounting**, one owner of **AI/observation/visibility**, and one integration conductor ensuring branch compatibility, CI and invariants. Different engineers should not independently invent incompatible versions of sovereign identity or war scope.

Every PR:

- links to relevant specification/decision and scenario IDs,
- states the authoritative state transitions,
- includes tests and precise evidence,
- preserves deterministic tick ordering and no free troops/gold,
- does not treat the number of passing isolated PRs as proof of integrated game behavior.

## Definition of done

A normal Solo NATIONAL game starts, AI nations compete independently using legitimate information, players can use pacts/defense/empires, war and peace operate in both layers, sanctions and blockades have real costs, fog works, final sovereign victory resolves correctly, and performance remains acceptable with many nations.

**Do not claim a feature complete until it works through the integrated game path.** No hidden "feature complete" label based solely on static interfaces or isolated mocks.

## Out of scope

Currencies, goods, loans/debt, note exchanges, collateral, discount/pricing overhaul, and large-scale economic rebalancing belong to a future version.
