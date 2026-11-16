# NATIONAL independent release gate — Engineer 5, Round Four

**Status: BLOCKED FOR PUBLIC RELEASE.** This is an executable QA gate, not a
claim that an in-browser authoritative game is secure for hostile PvP.

- QA starting integration SHA: `a4b0307a39fad2b65fb7848aa111e48e504fc5ef`.
- QA branch: `stage3/e5-round4-national-qa-20261116`.
- Integration target: `stage3/integration-20261115`.
- Contract: `prompts/ENGINEER_5_ROUND_4.md`, `docs/22-stage3-round4-integration.md`, issue #22.
- QA owns only new `tests/e2e/national/**`, `tests/qa/national/**`,
  `scripts/national-qa/**`, `docs/release/**`, and
  `.github/workflows/national-*qa*.yml`.

## 1. Reproduce the source gate

Use Node **24.15.0** and npm **12.1.0** with the committed lockfile:

```sh
npm run inst
npx --no-install vitest run --project node \
  tests/e2e/national/IntegratedAcceptance.test.ts \
  tests/qa/national/PacketCanaries.test.ts
npm run typecheck
npm test
npm run lint
npm run format:check
npm run build-prod
node scripts/national-qa/asset-audit.mjs
npm audit --json > national-qa-artifacts/audit-all.json || true
npm audit --omit=dev --json > national-qa-artifacts/audit-prod.json || true
node scripts/national-qa/audit-summary.mjs \
  national-qa-artifacts/audit-all.json \
  national-qa-artifacts/audit-prod.json
```

**CI:** `.github/workflows/national-release-qa.yml` runs the first
two test files and typecheck/lint/format plus audit artifacts; the existing
`national-baseline-ci.yml` supplies the full repository tests and production
build on a PR to integration. Require **both** to pass on the exact PR HEAD.
A green baseline on another SHA is NOT acceptance. The QA workflow prints
`head.txt`, per-seed SHA-256 records, timed test logs and audit JSON to an
artifact retained 30 days. Read the artifact, not just the workflow badge.

## 2. Actual-engine acceptance matrix

| Gate | Executable evidence | Pass condition |
| --- | --- | --- |
| M0 opt-in | `IntegratedAcceptance.test.ts` | NATIONAL only under unranked Solo FFA; legacy `nationalPoliticalAuthority() === null`; illegal Team/Public rejected |
| M1 founding | same, via **real GameRunner + Executor + SpawnExecution** | stamped `national_found_empire` executes on next game tick and authoritative emperor/member records change |
| M2 sovereign victory | same, via **WinCheckExecution** | final remaining empire wins even with unclaimed land; legacy FFA does **not** adopt NATIONAL victory |
| snapshot/restore | `roundTrip`, real `GameSnapshot` | re-encoded bytes match checkpoint exactly and restored political authority survives |
| replay | 2 named seeds, original + restored `GameRunner` | byte-identical SHA-256 snapshots for each of eight continued ticks; results emitted in logs |
| invalid commands | real command and runner scenarios | forged unknown client is NoOp; invalid name, pre-spawn and duplicate founding throw; no extra empire/assets |
| authorization | `PacketCanaries.test.ts` | actual GameRunner rejects foreign observer, stale client binding and unseen coordinate/tile probes |
| leakage | actual `GameRunner` and hostile injected authoritative updates | secret troop and ship strengths plus diplomatic string do not reach filtered packet |
| oracle sensitivity | deliberately tainted packet and packed typed arrays | inspection helper MUST throw; otherwise the test is falsely green |
| performance | five real projected ticks | under **8,000 ms** on CI; real measured value logged per run |

**Seed precision:** the scenario IDs `qa-seed-alpha` and
`qa-seed-bravo` are fixed game identifiers used by the real Executor, with
fixed real-map spawn points and distinct empire commands. The pair validates
two deterministic scenarios, not stochastic coverage of every RNG branch.
Their hashes are evidence only after the CI test runs; do not quote an
unexecuted expected hash as an actual result.

The direct GameRunner test resolves a supplied stamped clientID into a player.
Worker ingress additionally enforces that the stamp matches the session.
The test of an **unknown** stamp is end-to-end; an attack that asserts the
**other real client's** stamp in a modified browser cannot be made secure
by this Solo worker architecture.

## 3. Exact security boundary and packet audit

**Honest-client Solo boundary (limited but useful):**

1. `GameRunner` resolves its observer from the current
   `game.playerByClientID(viewerClientID)`, not a request's claimed observer.
   `isNationalRequesterAuthorized`, `isNationalIntentAuthorized`,
   `isNationalCoordinateVisible`, and `isNationalTileVisible` reject
   cross-principal probes and stale transfers.
2. `GameRunner.executeNextTick` constructs the ordinary game update then
   calls `NationalOutboundFilter.project` before the callback that
   `Worker.worker.ts` batches into `game_update_batch` and
   `run_turns_result`.
3. `NationalOutboundFilter` allowlists packet fields, strips unrelated
   diplomatic/event buckets, hides foreign gold/troops/tile/attack data,
   limits packed statistics to the owner, and sends only sighted unit data.
   Resync does not create a separate unrestricted stream.
4. Worker ingress explicitly denies NATIONAL `snapshot`,
   `extract_snapshot` and unrelated `human_stats`/`human_disconnects`
   RPCs. NATIONAL player actions, buildables, borders, profile, attacks and
   transport target queries require current principal/tile rights.
5. The new QA canary test injects a confidential diplomatic update and exact
   secret troop/ship amounts into a **real game**. This would catch
   an allow-all projection, accidental packed-unit pass-through or leaked
   confidential chat event. It also tests revoked identity and an unknown
   spectator and checks a restored game's resync.

**Hostile browser boundary: NOT PROTECTED.** The entire authoritative
`Game`, raw snapshot representation, troop strengths, worker scripts and
player registry exist in the user's browser process. The test explicitly
proves the raw authoritative snapshot contains hidden troop canaries.
A modified client can inspect memory, issue a forged local clientID,
replace worker code or bypass filtered packet APIs. These tests **do not**
certify trustworthy spectator privacy, competitive PvP anti-cheat or
confidential diplomatic secrets against that attacker.

**Trusted-host prerequisite:** move authoritative simulation and save/replay
state to an independent authenticated server. Bind every command to a
server-side principal, perform territorial/political/war resource checks there,
and project all tick, RPC, reconnect, replay, snapshot and spectator output
per principal before network transmission. Independently pen-test this
boundary before any claim of adversarial information secrecy.

**Unproven** until later integration: E2's full war/levy typed commands and
cross-war resource race behavior, E3's persisted last-known intelligence
on worker reconnect, E4's completed in-game click path, direct real-worker
message fuzzing, and every possible fog-of-war field. Do not convert a
passing packet unit into those broader guarantees.

## 4. Actual Chromium browser smoke (separate mandatory release gate)

This intentionally runs as a manually dispatched CI **browser-release-smoke**
job, not as an silently passing/skipped part of the required headless gate.

```sh
# On a machine with google-chrome or chromium and npm dependencies installed:
SKIP_BROWSER_OPEN=true CHROME_BIN=/usr/bin/google-chrome \
  node scripts/national-qa/browser-smoke.mjs --national
```

The executable launches the real Vite frontend and a headless Chromium page,
checks an actual rendered homepage, uses DevTools mouse input to click Solo,
NATIONAL, Start/Play and Found Empire controls, and requires a displayed
empire/emperor success result. It writes screenshots under
`national-qa-artifacts/` after each step. **Failure is blocking**, including
controls that are absent because E4 has not yet merged. This path must be
updated to the *verified* E4 UI labels once integrated; never fake the
button or set game state from the browser console to pass. Run the same flow
at 1280×800 and at a 390-pixel-wide mobile viewport in a manual browser.
Check keyboard tab/focus/Enter, one rejected action/error message, legacy
FFA start, full match, restart, performance and a fresh browser session.

The initial browser smoke is a boot/click-path check, **not** a replacement
for full gameplay / visual asset review, or for a real server-trusted attacker
test. Browser integration should also validate sound, image requests, map
rendering, WebGL recovery, console errors and unauthorized network requests.

## 5. Licensing and dependencies — independent blockers

### Issue #5 — restricted assets, OPEN

The repository retains `LICENSE` (AGPLv3 source),
`LICENSE-ASSETS` and `LICENSING.md` (open `/resources` are CC BY-SA 4.0,
`/proprietary` is all-rights-reserved), plus a *text-only archived*
`docs/upstream-licenses/PROPRIETARY-ASSET-LICENSE.txt`.
The protected `/proprietary` tree is absent in the QA starting tree.
Original NATIONAL `NationalLogo.svg` and `NationalMark.svg` exist.
`asset-audit.mjs` fails if `/proprietary` is introduced, checks key
frontend/PWA files and writes SHA-256 hashes of each. It **does not** prove
that every runtime asset or third-party font/audio license is cleared.

**Do not release** until a human performs the full missing-resource,
attribution, CDN/API asset, icon, audio and font audit, records replacements
and their licenses/hashes, and verifies browser playback without illegally
including restricted upstream resources. Preserve source/attribution notices;
do not imply upstream endorsement.

### Issue #6 — inherited dependency advisories, OPEN

Stage 2 recorded **17 advisories (4 critical, 7 high, 6 moderate)** from
Node 24.15.0 and npm 12.1.0. Engineer 5's first independent QA run
[43885685212](https://github.com/LeviCade/OpenFront-National/actions/runs/43885685212)
on PR SHA `d4b36ce5e3e96697584de0d1f95050be4d980b66` measured
**17 total advisories (4 critical, 7 high, 6 moderate)** and, with
`npm audit --omit=dev --json`, **7 production-tree advisories
(2 critical, 3 high, 2 moderate)**. These are tree-scope audit counts;
they do not by themselves establish production exploitability. CI stores
`npm audit --json` and `npm audit --omit=dev --json` separately.
An audit nonzero exit does not automatically fail this **development QA**
pipeline because that is an already-open **release gate**. Before public
release, classify each advisory by package/version, runtime vs dev exposure,
affected paths, patch availability and severity. Apply reviewed, minimal
lockfile changes; run full tests, build, browser and replay again. Never
`npm audit fix --force` without review.

## 6. Release checklist — all boxes mandatory

- [ ] Exact HEAD passes independent NATIONAL QA, all existing unit tests,
      typecheck, lint, format and production build on a merged integration SHA.
- [ ] Two seeded real scenarios log reproducible, equal replay hashes after
      snapshot/restore, plus expected sovereign and legacy FFA outcomes.
- [ ] Authorization, duplicate-command and packet leak canaries pass and their
      deliberately corrupted controls cause a definite test failure.
- [ ] E2 live attack / war / defensive levy reconciliation passes real combat
      and duplicate debit tests after its merger.
- [ ] E3 live AI / persisted sight / reconnect behaves correctly in an actual
      worker with snapshot/replay.
- [ ] E4 NATIONAL Solo → spawn → Found Empire succeeds through a real clickable
      desktop and mobile UI; illegal actions show feedback.
- [ ] Chromium screenshot and playthrough artifacts inspected; keyboard,
      WebGL, sound and asset paths verified, with no unaudited proprietary
      dependencies.
- [ ] Licensing and restricted-assets issue #5 is documented and resolved.
- [ ] npm audit issue #6 is triaged and production exposure remediated.
- [ ] Hostile-client limitations accepted explicitly for any local Solo use;
      trusted-host security review completed before adversarial PvP.
- [ ] All measurable perf thresholds and full-browser frame-time budgets met
      on representative hardware; unexpected CI regressions investigated.
- [ ] Conductor separately reviews artifacts and owns the integration merge.

A green isolated engineer PR, a successful source build or a browser screenshot
alone proves NONE of the unchecked gates.
