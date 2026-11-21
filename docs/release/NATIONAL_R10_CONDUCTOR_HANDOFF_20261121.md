# 👑 OpenFront NATIONAL — Round Ten Conductor Permanent Handoff
**Last audited:** November 21, 2026 (America/Chicago) · **Role:** successor Conductor, six engineer lanes.
**Start here:** [Round Ten coordination #48](https://github.com/LeviCade/OpenFront-National/issues/48) · [Official ledger #20](https://github.com/LeviCade/OpenFront-National/issues/20) · [Historical Round Nine #45](https://github.com/LeviCade/OpenFront-National/issues/45).

## Authoritative accepted state
- **Completion = 33%**, original weighted M0–M9 rubric, opening historical 16 unallocated. Round Eight 27%; Round Nine +6 (M1+2, M2+1, M3+2, M4+1). **M9 +0**. Never reset to 27 or claim a Round Ten point without new integrated accepted scenarios.
- **Integration:** `stage3/integration-20261115` at `0e52b5eeb7490ce83898f2a9696732c7e7d6b21c` at succession. Round Nine PR [#47](https://github.com/LeviCade/OpenFront-National/pull/47) merged `c4d1b27378ee6f895fc89d99d63abcb585afa8ff`, then one documentation ledger commit. Former engineer PRs #37/#38/#39/#40/#41/#46 closed without individual merges; their source survived in #47. **Do not repeat R9 or use their heads as the new base**.
- Exact integration-head [Source CI #44883951734](https://github.com/LeviCade/OpenFront-National/actions/runs/44883951734) SUCCESS and [independent QA #44883951757](https://github.com/LeviCade/OpenFront-National/actions/runs/44883951757) SUCCESS; 11,589 passed / one skipped on merged Round Nine; do not conflate with full browser acceptance.
- Real physically backed Intel HD 4600 / VirGL WebGL1/WebGL2 shaders established in [diagnostic #44881965453](https://github.com/LeviCade/OpenFront-National/actions/runs/44881965453), which **FAILED as a four-mode job**. NATIONAL desktop/mobile reached spawn stage but both failed to complete; legacy desktop/mobile exited 0 but detailed collector reports were missing. Another documented NATIONAL desktop run spawned a human with 52 tiles. This is diagnostic evidence, not a signed release.
- Public release **BLOCKED**: [asset provenance/missing licensed music #5](https://github.com/LeviCade/OpenFront-National/issues/5), [dependency/security review #6](https://github.com/LeviCade/OpenFront-National/issues/6), owner-independent signed physical host witness + trusted key enrollment, all four real browser modes, protected server authority and hostile-client fog confidentiality.

## Six Round Ten independently owned engineering orders
All six branches were created from the exact same accepted integration SHA above. **They have not been automatically executed as separate ChatGPT engineer sessions.** Launch each engineer with its issue body; every branch targets `stage3/integration-20261115`.

| Role | Work order | Existing new branch | Outcome |
|---|---|---|---|
| E1 political authority | [#49](https://github.com/LeviCade/OpenFront-National/issues/49) | `feature/r10-e1-sovereign-command-loop-20261121` | Real authenticated empire consent, accession, leadership transfer, outcomes/replay |
| E2 combat mechanics | [#50](https://github.com/LeviCade/OpenFront-National/issues/50) | `feature/r10-e2-live-combat-levy-20261121` | Human WAR → map attack → real MDA troop debit → peace; conservation and replay |
| E3 AI/fog | [#51](https://github.com/LeviCade/OpenFront-National/issues/51) | `feature/r10-e3-ai-observation-roundtrip-20261121` | Multi-turn AI legal acts through actual engine, recipient private packet negatives |
| E4 game UX | [#52](https://github.com/LeviCade/OpenFront-National/issues/52) | `feature/r10-e4-playable-national-ui-20261121` | Actual Solo/NATIONAL desktop & touch mobile player interactions and receipts |
| E5 independent QA/security | [#53](https://github.com/LeviCade/OpenFront-National/issues/53) | `feature/r10-e5-independent-playability-qa-20261121` | Four-mode independent browser, hostile client, attestation, assets/deps |
| E6 Skybot GPU | [#54](https://github.com/LeviCade/OpenFront-National/issues/54) | `feature/r10-e6-skybot-gpu-evidence-20261121` | One-guest GPU four-mode diagnostics, exact-source/safe artifacts and host trust boundary |

## Core technical contracts — do not redesign them
1. E1 owns `NationalGovernanceState` and Game political journal. E2 calls Game-owned `performNationalWarCommandWithOutcome`, owns authenticated `NationalWarExecution`, `AttackExecution`, levy; **no second mutable WAR ledger**. E1/E2 agree before touching `GameImpl.ts` or `Schemas.ts`.
2. E3 observes the actual committed engine and filters `NationalOutbound` per recipient before worker packets. The client can only confirm E1/E2 outcomes by matching real requestId + actor + recipient + sequence + authoritative politics/war projection.
3. E4 owns `NationalDiplomacyPanel.ts`, `NationalDiplomacyState.ts`, `Transport.ts`, `GameView.ts`; do not synthesize Game state or optimistic acceptance. E5 owns `scripts/national-qa/browser-gameplay.mjs`, real CDP tests, hostile negatives and `gpu-attestation.mjs`; E6 owns `.github/workflows/national-hardware-acceptance.yml` and `scripts/national-gpu-ci/**`.
4. **E5 and E6 have distinct GPU jobs:** E5 determines test and signed evidence validity. E6 makes genuine GPU dispatch/collector function. `NATIONAL_REQUIRE_HARDWARE_GPU=1` may **never** be redefined into a text renderer check. The signing private key must never enter the guest; no fabricated host signature or automatic trust-root enrollment.
5. The existing strict workflow on integration expects manual dispatch from `main`; it is not enough to add a workflow to integration. E6 must prepare a safe Conductor-reviewed default-branch promotion. No unreviewed main promotion or secret-host access assumed.
6. Preserve upstream AGPL / CC attribution; restricted/proprietary sources and missing music remain blocked. No deferred NATIONAL economics redesign.

## Target: +5–10 only for NEW accepted player-game scenarios
A genuine NATIONAL match with human authentic actions, authoritative combat outcomes, participating AI, real GPU rendering and independent verification. **38–43% is conditional**, not earned. Separate in all reports:
- **Source accepted?** Exact combined staging HEAD, full typecheck/test/format/lint/build, independent GameRunner/replay/privacy QA and *exact post-merge integration HEAD* checks.
- **Browser gameplay accepted?** Real Chromium on admitted GPU, four explicit NATIONAL/legacy × desktop/mobile passes through HUD, human spawn, player commands and authoritative outcomes. Diagnostics alone cannot earn release acceptance.
- **Public release security accepted?** Independent trusted host authority, signed witness/key, hostile-client secrets, original/licensed assets, dependency/security and release gate. This remains blocked until *all* are proven.

## Conductor's operational loop
1. Read live GitHub Issue #20/#48, work orders #49–#54, accepted PR #47 and latest branch refs. Notes and historical SHA become stale.
2. Delegate six meaningful nonoverlapping tasks simultaneously; no engineer idle and no Conductor writing their feature code. Each engineer reports changed files, real new behavior, exact SHA, local tests, CI results and blockers in its issue.
3. Local formatting and targeted tests first. Avoid redundant all-suite jobs, CI for basic formatter mistakes, and repeated unmodified GPU diagnostics. Keep expensive GPU work single-guest/one-install/sequential four-mode.
4. Review interfaces and assemble one exact *combined* integration candidate with all accepted slices; run full source + independent QA + real browser gating; merge only reviewed passing development source.
5. Re-check exact integration HEAD and workflows. Update this handoff/Issue #48 and, **only after accepted disjoint new scenarios**, Issue #20 + `docs/21-progress-of-project.md`. No points for drafts, project notes, review comments, old branches, home screen, or unsigned GPU diagnosis.
6. If another session ends, successor reads this handoff and Issue #48 **before** dispatching. Preserve accepted branch SHA and historical ledger. Do not dissolve/duplicate engineers because of context loss.

**Current verdict at issuance:** source accepted (Round Nine); full real browser gameplay not accepted; public release blocked. **Round Ten increment: 0.**
