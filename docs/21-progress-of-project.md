# PROGRESS OF PROJECT — NATIONAL release completion

**Canonical issue:** [#20](https://github.com/LeviCade/OpenFront-National/issues/20).
**Scope:** the tested, integrated and eventually shippable NATIONAL game,
not isolated code, PR totals or documentation.

## Permanent weighted scorecard

| Milestone                                                              | Available | Verified |
| ---------------------------------------------------------------------- | --------: | -------: |
| M0 — Solo opt-in, authoritative identity, snapshot, command foundation |        10 |       10 |
| M1 — actual sovereign metrics, victory, Ungovernable lifecycle         |        10 |        9 |
| M2 — real coalition/pact/accession/crown consent                       |        10 |        2 |
| M3 — actual layered war/peace enforcement                              |        12 |        0 |
| M4 — actual conserved troop interception                               |        12 |        0 |
| M5 — imperial treasury/governance/collapse                             |        10 |        0 |
| M6 — coercion, sanctions, naval warfare                                |        10 |        0 |
| M7 — trusted per-principal fog across real outbound and AI             |        10 |        0 |
| M8 — national-interest AI taking legal real actions                    |         8 |        0 |
| M9 — player experience, release quality, security, licensing           |         8 |        0 |
| **TOTAL**                                                              |   **100** |   **21** |

## Historical scoreboard

| Review                             | Previous | Earned | Verified | Evidence                                                                                                                                                                                                                                |
| ---------------------------------- | -------: | -----: | -------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manager baseline before Round Four |        — |      — |      16% | Adopted management baseline: M0=10, M1=6, others 0                                                                                                                                                                                      |
| Round Four — E1 political gameplay |      16% |     +5 |  **21%** | E1 [PR #18](https://github.com/LeviCade/OpenFront-National/pull/18), merge `90259d78670161dee4b58bbfd83ec63bbbb67c55`, [combined full CI #43878979429](https://github.com/LeviCade/OpenFront-National/actions/runs/43878979429) SUCCESS |

**Newly earned:** M1 +3 for actual eight player metrics, real winner
roster and persisted deterministic 10-second warnings; M2 +2 for
live imperial accession, crown transition, NAP consent and Betray
with real engine tests. The merged #14 conflict foundation remains
M3/M4=0 until real attack legality, atomic balances and replay are
wired. E3 PR #19 remains M7/M8=0 until exact-head full CI, merge
and measured integrated behavior. Do not count synthetic benchmark
or browser UI filtering as a trusted hostile-client boundary.

## Scoring policy

- Award a point only once, to one milestone, for an accepted real-game scenario
  passing full CI on the exact **combined integration SHA**.
- An isolated implementation, unit-only suite, source diff, mock UI, documentation,
  or green feature-branch CI does not independently earn progress.
- No milestone can exceed its weight. Unresolved production release
  conditions keep M9 incomplete.
- After each round, record old %, earned points, new %, exact SHA,
  CI URL, visible behavior, defects and owners in this file and issue #20.
- **Round Five target: 26–31%.** Missing +5 must have a specific
  failed acceptance, responsible owner and executable recovery.
- Revise prior credit downward if an actual regression invalidates its proof.
