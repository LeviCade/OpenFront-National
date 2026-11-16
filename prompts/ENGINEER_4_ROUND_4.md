# 🎮👑 OPENFRONT NATIONAL — ENGINEER #4, ROUND FOUR

**MISSION: THE PLAYER MUST BE ABLE TO FOUND AN EMPIRE IN THE UI.**

Repository `LeviCade/OpenFront-National`.
Create branch `stage3/e4-round4-national-ui-20261116` from CURRENT
integration HEAD; record SHA, PR target `stage3/integration-20261115`.
Read `docs/22-stage3-round4-integration.md` and issue #21.

**You exclusively own:** `src/client/**`, new NATIONAL UI
components and `tests/ui/national/**`. No `GameImpl`, `Schemas`,
`GameRunner`, worker, combat code or E1/E3 tests.

**SHIP A REAL SCREEN:** NATIONAL Solo selection works and is visually
distinct from Impossible; in-game "Found Empire" control appears
only when alive/spawned/authorized, sends the **existing**
`national_found_empire` stamped intent through the normal command
producer, displays real state/leader roster/accepted-or-rejected
feedback (never a fake local success). Provide a usable nation/empire
diplomacy panel scaffold that consumes *public authoritative* states.
NAP/MDA/peace actions that lack E2 schemas must be explicitly disabled,
not silently simulated.

**PROOF:** one real user-control to game-execution test, saved-state
continuity and duplicate-click defense; responsive desktop/mobile
screenshots, keyboard and accessible controls, unchanged non-NATIONAL
UI, full exact-head CI. Inform E2 immediately of any missing
wire schema, continue working on already-supported founding.

**A FEATURE IS NOT REAL IF THE PLAYER CANNOT USE IT.**
