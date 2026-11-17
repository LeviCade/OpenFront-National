# OpenFront NATIONAL — Round Six exact combined-game verdict

**RELEASE VERDICT: FAIL / BLOCKED.** This report is based on actual
integration evidence. A green homepage, a loading overlay, a queued command,
isolated PR CI, or an unverified software-WebGL browser is not accepted
gameplay.

## Candidate and source provenance

- Project: `LeviCade/OpenFront-National`, Conductor [#33](https://github.com/LeviCade/OpenFront-National/issues/33)
- Combined staging: `stage3/round6-combined-acceptance-20261116`
- First five-way candidate: `1bf6f408a08115dfc725230e032686855194b6c3`
- Verified integration base: `96e91430d9b12e99b55490b7ca62426d7d5992fc`
- E1 #31 input: `650a3af5e338c8a8042a40f432ade3a99b65631d`
- E2 #28 input: `4691174f565189a9ca2c895ac02add5d7d87163d`
- E3 #29 input: `a09eb85aa1ab33970f912ed738894095417594b8`
- E4 #32 input: `a4c5f9d1a909588423f5522bb7438761cda372d4`
- E5 #30 input: `6e74a2fdcac0bddb72dddeb371f9370d9e11375d`
- Staging CI trigger: [draft PR #34](https://github.com/LeviCade/OpenFront-National/pull/34).
  Draft PR **MUST NEVER be merged by E5**. Conductor owns production promotion.

The five branches were integrated through non-force, two-parent merge commits,
preserving original authorship and commit histories. Files modified by each
owner were non-overlapping. E5 never patched another owner's gameplay code.

## Initial combined candidate: evidence-based checks

| Gate                                                                    | Initial finding                                    | Evidence / owner                                                                                                                                                                                           |
| ----------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent actual game WAR / MDA / fog tests                           | **PASS: 16/16** targeted tests                     | [strict QA run 43988962731](https://github.com/LeviCade/OpenFront-National/actions/runs/43988962731)                                                                                                       |
| E5 accepted war attacks and MDA troop debit                             | **PASS** on combined source                        | Same run; no test-only donor port                                                                                                                                                                          |
| E5 duplicate CAS, unauthorized attack, forged source                    | **PASS** negative tests                            | Same run                                                                                                                                                                                                   |
| Snapshot restore & deterministic five-tick replay                       | **PASS** targeted                                  | `1d10c42119e01252820a2abe2a680b323ecb0f83040109ff055b7147e6d09d3f` → `622d0571480261be3a6bf62ec1fc1a8dfa9b894debf00feb28b8f79d12132b01`; exactly 20,000 intercepted                                        |
| Full TypeScript source check                                            | **FAIL** on initial combined commit                | [CI 43988962843](https://github.com/LeviCade/OpenFront-National/actions/runs/43988962843); E3-owned `NationalPoliticalPackets.test.ts:44` uses mutable `PoliticalPrize[]` instead of readonly protocol DTO |
| Full repository tests                                                   | **NOT EXECUTED** by baseline after TypeScript fail | Requires independent all-tests job on exact head                                                                                                                                                           |
| Full lint                                                               | **FAIL** on initial combined commit                | E2-owned `LiveWarExecutionRound5.test.ts:132,151` unsafe optional-chain non-null                                                                                                                           |
| Pinned format                                                           | **E5 isolated PASS**, combined not certified       | Exact E5 head 6e74, strict workflow format step passed; combined lint abort prevented format step                                                                                                          |
| Production build                                                        | **NOT EXECUTED** by baseline after TypeScript fail | Requires independent build job on exact head                                                                                                                                                               |
| Desktop NATIONAL real Chromium                                          | **FAIL: infrastructure**                           | [CI 43988962731](https://github.com/LeviCade/OpenFront-National/actions/runs/43988962731): real WebGL gate `software`                                                                                      |
| Mobile NATIONAL real Chromium                                           | **FAIL: infrastructure**                           | Same run: software WebGL; no gameplay success                                                                                                                                                              |
| Desktop/mobile legacy FFA                                               | **FAIL: infrastructure**                           | Same run: both blocked by actual game WebGL gate, not accepted                                                                                                                                             |
| GPU/driver/WebGL2 capability                                            | **PENDING additional evidence**                    | Enhanced browser script records actual WebGL renderer and CDP GPU info without faking GPU                                                                                                                  |
| Real authored click → exact requestId → accepted recipient receipt → UI | **NOT PROVEN**                                     | New E5 Round Six browser gate requires equality of outgoing event token and E1/E3 results                                                                                                                  |
| Rejected/duplicate founding request                                     | **NOT PROVEN in browser**                          | Must correlate separate requestId; never accept client-only rejection text                                                                                                                                 |
| Save/restore in NATIONAL browser                                        | **BLOCKED**                                        | Worker raw snapshot export intentionally forbidden; authenticated trusted-host persistence not yet proven                                                                                                  |
| Sovereign victory in GPU-backed Chromium                                | **NOT PROVEN**                                     | No actual live match reached, no victory screenshot or packet                                                                                                                                              |
| Release licensing and restricted assets                                 | **BLOCKED #5**                                     | Automated key asset hash checks are not manual rights clearance                                                                                                                                            |
| npm dependency audit                                                    | **BLOCKED #6**                                     | 17 total advisories (4 critical / 7 high / 6 moderate), 7 production (2 critical / 3 high / 2 moderate)                                                                                                    |
| Hostile-browser confidentiality                                         | **BLOCKED by architecture**                        | Honest recipient-filtered worker packets do not protect authoritative game memory from a modified browser                                                                                                  |

## Full-suite and mutation follow-up on combined `f2abef10`

- [Exact-source full Vitest run 43991007886](https://github.com/LeviCade/OpenFront-National/actions/runs/43991007886) completed **11,497 passed, two failed, one skipped** across 776 test files.
- **E2-owned failure:** `tests/national/NationalFoundEmpireRequestId.test.ts:102` expected a null token for a legacy authenticated founding intent, whereas E1's canonical journal deterministically returned `auto:3:0`. The expectation must be reconciled by E2 with E1's proven backward-compatible issuance and actor scope. E5 cannot rewrite it.
- **E5-owned test assumption repaired:** 3-donor roster was assumed to follow invitation order `east,west,center`; E1 canonical `nationalMdaAllies` correctly returned `center,east,west`. E5 now asserts a separate alphabetically sorted expected donor roster and matching receipt order, leaving conservation unchanged. The three-donor receipt **PASSED** the exact-head targeted rerun on updated candidate `51b2ae2d`.
- **Two-donor real MDA scenario PASS:** `r6-east` and `r6-west` each debited exactly 50,000, 100,000 attacking troops intercepted, no phantom in-flight troops. Snapshot SHA-256 `bf98d58f4b186de5b486e8c71cf48ef38cd216c11453f3eb813e2e405c54640f`.
- **Exact actor/recipient request receipts PASS:** `qa_r6_req_first` accepted sequence 0; `qa_r6_req_rejected` rejected sequence 1, actor `r6-north`. These are real GameRunner worker-facing packet tests, **not browser click acceptance**.
- [Mutation controls 43991007886](https://github.com/LeviCade/OpenFront-National/actions/runs/43991007886): **3/3 PASS**, proven failures from real unauthorized WAR bypass, stale-CAS bypass and hidden-player packet leak. Disposable modified production files were restored byte for byte after each case.
- [Strict Chromium 43991007795](https://github.com/LeviCade/OpenFront-National/actions/runs/43991007795): all four browser modes failed the _actual_ WebGL gate. Chrome 157 WebGL2 context exists but ANGLE/Vulkan renderer is SwiftShader Device (Subzero), max texture 8192. No GPU-backed gameplay success. Report explicitly distinguishes hardware insufficiency from gameplay mechanics.
- Current source blocking E3 `NationalOutbound.ts:314` TS18048, E2 unsafe optional chains, E2/E4 pinned format, and seven production dependency advisories. Source-owner reports posted on their own PRs.

## Updated combined staging: 19/19 targeted PASS

- Updated staging SHA: `51b2ae2de212a35c9cf5880e9bcf27bb4f736e03` (non-force merges incorporating E4 pinned formatting and E5 donor-order correction, original five-source ancestry retained).
- [Exact-head targeted WAR/MDA/FOG/CAS/receipt run 43992114899](https://github.com/LeviCade/OpenFront-National/actions/runs/43992114899): **19 passed / 0 failed**, five test files. This demonstrates **both genuine two-donor and three-donor MDA defense** using canonical Game/AttackExecution/Player troop balances. Both intercept exactly 100,000 and leave zero in-flight attackers without double charges.
- Two-donor receipt: `r6-east:50000, r6-west:50000`; deterministic snapshot SHA-256 `bf98d58f4b186de5b486e8c71cf48ef38cd216c11453f3eb813e2e405c54640f`.
- Three-donor receipt: `r6-center:33334, r6-east:33333, r6-west:33333`; deterministic snapshot SHA-256 `119274c0ecf2865de0888d07edfbf1be329e4e209ffc2beaa1e623eddd9a0cf6`.
- Accepted founding `qa_r6_req_first` is correlated to journal sequence 0 and actor `r6-north`; distinct rejected `qa_r6_req_rejected` is sequence 1. E3 recipient filtering excludes foreign acknowledgments.
- The overall job is **RED** despite 19/19 gameplay tests because E3 `NationalOutbound.ts:314` TS18048 and E2 lint/format fail, and the full-suite legacy E2 expectation remains unresolved. These are not waived by green targeted tests.

## Round Six acceptance extensions

Owned QA source adds independent real two- and three-donor MDA conservation,
forged donor roster negative cases, exact per-click request ID correlation
across the existing authenticated Executor → E1 journal → E3 GameRunner
pipeline, and deliberate source mutation probes executed ONLY in disposable
CI worktrees. Mutations deliberately create unauthorized offensive approval,
disable stale CAS balance detection, and leak foreign PlayerUpdate fields.
Each individual targeted real test must turn RED and the source restored byte
for byte before the next probe. A compile error, missing test or timeout
cannot count as a successful negative control.

The dedicated Round Six CI workflow runs **on exact PR head SHA**, not GitHub's
synthetic PR merge ref, with **separate jobs** for TypeScript, full Vitest,
lint, pinned format, production build, negative controls and the security
audit. Individual failures do not suppress evidence for other gates.

GPU-backed browser acceptance is a separate manually dispatched job requiring
a real `self-hosted, linux, x64, gpu` runner. Standard hosted GitHub
Chromium on this project currently presents the application WebGL software
renderer hard stop. E5 never patches or spoofs the game WebGL gate to turn
this into a green result.

## Mandatory human / Conductor review before promotion

No release promotion is authorized by this document or a green isolated job.
Conductor must review the latest combined commit, all exact-head CI,
independent negative mutation logs, actual GPU-backed desktop/mobile
screenshots, browser console and public packet trace, replay hashes, WAR/MDA
resource receipts, exact client request IDs, trusted-host persistence, and
issues #5/#6. All gameplay and security rows must pass independently.
