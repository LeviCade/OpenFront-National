# PROGRESS OF PROJECT — NATIONAL release completion

**Canonical ledger:** [issue #20](https://github.com/LeviCade/OpenFront-National/issues/20).
**Scope:** verified integrated gameplay, not isolated PRs or test counts.

## Original Manager-issued weighted milestone rubric (RESTORED)

The first Conductor ledger accidentally changed M0, M1, M5, and M9
weights. This document restores the **original** 100-point rubric;
do not silently reweight future checkpoints.

| Milestone                                                   |  Weight |
| ----------------------------------------------------------- | ------: |
| M0 — Solo opt-in, authority, mode and snapshots             |   **8** |
| M1 — real sovereignty, victory and Ungovernable state       |  **12** |
| M2 — coalitions, pacts, empire accession and consent        |  **10** |
| M3 — layered war and mutual peace in combat                 |  **12** |
| M4 — conserved real troop interception, replay safety       |  **12** |
| M5 — imperial resource, military and collapse governance    |  **12** |
| M6 — sanctions, embargoes, piracy and naval enforcement     |  **10** |
| M7 — fog and intelligence from authorized real observations |  **10** |
| M8 — legal national-interest AI decisions and actions       |   **8** |
| M9 — player interface, independent QA, release readiness    |   **6** |
| **TOTAL**                                                   | **100** |

## Historical ledger — immutable opening balance

| Checkpoint                       | Previous |             Earned | Reported | Evidence                                                                                                                                                                         |
| -------------------------------- | -------: | -----------------: | -------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manager's initial estimate       |        — |                  — |  **16%** | Opening estimate, **not independently allocated**                                                                                                                                |
| Round Four political integration |      16% |             **+5** |  **21%** | PR #18 merge `90259d78670161dee4b58bbfd83ec63bbbb67c55`; [full combined source CI #43878979429](https://github.com/LeviCade/OpenFront-National/actions/runs/43878979429) SUCCESS |
| Round Five work in review        |      21% | **0 verified yet** |  **21%** | QA PR #26 and UI PR #27 merged as foundations; connected click-through and latest canonical WAR + levy acceptance pending                                                        |

## Round Eight accepted development-source milestone

**21% → 27% (+6 points)**. PR #34 merged at
`5e956e13f9e3b054c15cfd75110284c5a48fdd5c`.
The full source suite passed on this exact integration SHA:
[CI #44020170131](https://github.com/LeviCade/OpenFront-National/actions/runs/44020170131),
776/776 test files, 11,502 tests passed, one skipped, TypeScript,
lint, pinned format, and production build. Independent
[QA #44020170176](https://github.com/LeviCade/OpenFront-National/actions/runs/44020170176)
passed real GameRunner/replay/packet checks and Chromium landing.
The strict real WAR/MDA/CAS/replay engine job passed on an identical
source tree in [#44019560323](https://github.com/LeviCade/OpenFront-National/actions/runs/44019560323).

- **M3 +2:** actual declared WAR, undeclared attack denial, and
  independent national/imperial peace layers (WAR-01/03/04/07).
- **M4 +2:** real two-/three-donor MDA troop interception, CAS
  conservation, duplicate/forged debit guards, and deterministic
  replay (LEVY-01/05 and safety regressions).
- **M7 +1:** principal-bound sight memory, revoked empire
  intelligence, and recipient-scoped packets (FOG-06).
- **M8 +1:** legal war-aware AI real attack, ally exclusion, and
  undeclared-war refusal.

No M9, public release, trusted-host save, asset or dependency
security completion is scored. GPU-backed full browser gameplay,
hostile-client confidentiality, asset rights #5 and production
dependency advisories #6 remain release blockers.

The +5 after the opening baseline is traceable: **M1 +3** for real
player-backed metrics, victory and persisted Ungovernable warning;
**M2 +2** for actual Game-owned accession, crown and pact transitions.
The earlier ledger's M0=10/M1=6 allocation of the initial 16 was
unsupported and has been **retracted**, not silently converted. We
retain that 16% as an unallocated historical opening balance and
do not count it again.

## Round Nine accepted six-engine development source

**27% → 33% (+6 points).** [PR #47](https://github.com/LeviCade/OpenFront-National/pull/47)
merged as `c4d1b27378ee6f895fc89d99d63abcb585afa8ff`.
Exact merged-commit [source CI #44883503405](https://github.com/LeviCade/OpenFront-National/actions/runs/44883503405)
passed 788 test files, 11,589 tests (one skipped), TypeScript,
lint, pinned formatting and production build. Exact merged-commit
[independent QA #44883503446](https://github.com/LeviCade/OpenFront-National/actions/runs/44883503446)
passed live GameRunner/replay/hostile-packet checks and Chromium landing.
Strict WAR/MDA/CAS and replay
[#44883140968](https://github.com/LeviCade/OpenFront-National/actions/runs/44883140968)
passed on the identical Git source tree
`8f86416c7bdc46e83e223a3ac49758fdc9b5a788`.

- **M1 +2:** SOV-03/04/05/06: eight-player imperial victory,
  crown transfer, eight-metric crisis warning/rescue and
  emperor-elimination dissolution under deterministic replay.
  This advances prior basic victory/warning coverage.
- **M2 +1:** COAL-03/04/06/07: distinct authenticated player
  constitutional ballots, unanimous amendment, forbidden expulsion
  and membership-invalidation replay. Prior credit concerned basic
  accession, crown and pact transitions, not amendments.
- **M3 +2:** WAR-09/10/11/12: in-flight missile/MIRV and naval
  post-peace safety; WAR-R9: authenticated accepted/rejected WAR
  journal results and recipient-filtered command correlation.
  Prior basic WAR declaration/peace credit is not repeated.
- **M4 +1:** LEVY-04/05/06/07: real two-front overlapping MDA
  funding, 20 microattacks, reserves/caps and conserved donor troop
  balances through snapshot/replay; beyond prior simple levies.

**M9 +0.** Real owner-operated Skybot Intel VirGL powered legacy/FFA
desktop/mobile gameplay and NATIONAL desktop's human spawn with
52 owned tiles, but complete NATIONAL founding, mobile spawning,
independent signed hardware attestation and protected-host
confidentiality remain unaccepted. Asset provenance and missing
music are separate release blockers. Production npm audit is zero,
but development advisories still require review. **No public release.**

## Round Ten accepted six-engine development source

**33% → 38% (+5 verified points).** Six engineers' 42 distinct
changed paths were assembled in [PR #62](https://github.com/LeviCade/OpenFront-National/pull/62)
and MERGED into `00e4269603b7bb86abdc101d0c5eeeb5c0a267bf`.
The merged tree `3c9f710a361fa9938678c00a0fb932319214c719`
is byte-identical to reviewed combined candidate `6c2452ef001c0b8dfebd87aee87c27a01a2afbdc`.
[Exact merged-source CI #44920349492](https://github.com/LeviCade/OpenFront-National/actions/runs/44920349492)
**SUCCESS**: 798 passing files, 11,639 passing tests, one skipped,
typecheck/lint/pinned formatting/build all passed.
[Exact merged independent QA #44920349473](https://github.com/LeviCade/OpenFront-National/actions/runs/44920349473)
**SUCCESS**: real GameRunner/replay/hostile packets and Chromium smoke.
The identical candidate tree also passed all seven
[R6 source gates #44919852298](https://github.com/LeviCade/OpenFront-National/actions/runs/44919852298)
and WAR/MDA/CAS/replay in
[#44919852256](https://github.com/LeviCade/OpenFront-National/actions/runs/44919852256).

New credit, distinct from previously awarded R4/R8/R9 scenarios:

- **M2 +1:** authenticated stamped offer/recipient-only Game invitation/
  consent/exclusive membership/crown transfer and request replay using
  real GameRunner. Different from R4 basic succession and R9 ballots.
  Worker recipient packet delivery and human-facing controls are NOT done.
- **M3 +2:** actual legal WAR → real map assault → troops/tiles change →
  lawful peace, forged/zero-strength/after-peace denial and replay.
  Prior WAR legality and missile-cessation points are not repeated.
- **M4 +1:** live donor troop spending while genuine territorial combat
  occurs, with one donor on two simultaneous fronts; not just the
  previously scored microattack levy conservation.
- **M8 +1:** two real NationExecution bots plus authenticated GameRunner
  human; bot-issued accepted WAR, genuine attack/damage, peace and replay.
  Full real rejected-declaration → cooldown → alternate attack through
  ordinary bot ticks remains unverified and gets zero additional credit.

**M9 +0.** The first reviewed
[Skybot R10 four-mode GPU diagnostic #44920010367](https://github.com/LeviCade/OpenFront-National/actions/runs/44920010367)
actually ran all four on observed Mesa Intel VirGL WebGL1/WebGL2.
Legacy FFA desktop/mobile **PASS diagnostic**. NATIONAL desktop
**FAIL at found-empire receipt**; NATIONAL mobile **FAIL at spawn**.
[Sanitized evidence](https://github.com/LeviCade/OpenFront-National/actions/runs/44920010367/artifacts/14713027849)
is UNSIGNED: not public-release attestation, independent host cleanup
verification or 4/4 game acceptance. E5 owns browser action/receipt
verification, E4 human UI and mobile map access, E2 engine triage only
if proven, E3 private invitation packets. Trusted host/server,
licensed missing music, inherited asset provenance and dev advisories
remain open.

**Accounting: 16 opening + 5 R4 + 6 R8 + 6 R9 + 5 R10 = 38%.**
Original M0–M9 milestone weights unchanged. The lower Manager 38–43%
development progress goal is met; NATIONAL game playability and
public release are not accepted.

## Scoring controls

- Each new point requires identifiable **real engine or browser**
  behavior, exact combined integration commit, full CI success and
  an acceptance scenario; PR-head CI alone does not earn points.
- Do not double-count scenarios across milestones. The original
  weights are ceilings for new milestone allocation; the prior
  historical 16 remains an unallocated opening estimate rather than
  retroactively invented milestone achievements.
- **Current: 38%. Round Ten 38–43% target met at its lower bound.** Further points require
  additional accepted integration scenarios and the same CI discipline.
- Never treat honest-client Solo Web Worker filtering as hostile
  client fog security. A trusted-host server is a separate release gate.
- Asset licensing issue #5 and inherited advisories issue #6 remain
  open; no public-release approval has been granted.
- Update both this file and [issue #20](https://github.com/LeviCade/OpenFront-National/issues/20)
  after each accepted integrated slice.
