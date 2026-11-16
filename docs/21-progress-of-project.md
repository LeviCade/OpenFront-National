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

The +5 after the opening baseline is traceable: **M1 +3** for real
player-backed metrics, victory and persisted Ungovernable warning;
**M2 +2** for actual Game-owned accession, crown and pact transitions.
The earlier ledger's M0=10/M1=6 allocation of the initial 16 was
unsupported and has been **retracted**, not silently converted. We
retain that 16% as an unallocated historical opening balance and
do not count it again.

## Scoring controls

- Each new point requires identifiable **real engine or browser**
  behavior, exact combined integration commit, full CI success and
  an acceptance scenario; PR-head CI alone does not earn points.
- Do not double-count scenarios across milestones. The original
  weights are ceilings for new milestone allocation; the prior
  historical 16 remains an unallocated opening estimate rather than
  retroactively invented milestone achievements.
- **Current: 21%. Next target: 26–31%.** Missing +5 requires a
  specific failed acceptance, owner and repair plan.
- Never treat honest-client Solo Web Worker filtering as hostile
  client fog security. A trusted-host server is a separate release gate.
- Asset licensing issue #5 and inherited advisories issue #6 remain
  open; no public-release approval has been granted.
- Update both this file and [issue #20](https://github.com/LeviCade/OpenFront-National/issues/20)
  after each accepted integrated slice.
