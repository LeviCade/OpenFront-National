# OpenFront NATIONAL — Engineer #5 Round Five independent release acceptance

**Decision: BLOCKED.** A homepage, selected mode, visible game-start overlay,
queued founding request or green unit-test matrix is **not** proof that a
human can play NATIONAL. PR #30 intentionally contains release gates that
fail where the combined source does not yet implement the required behavior.

- Repository: `LeviCade/OpenFront-National`
- E5 branch: `stage3/e5-round5-browser-acceptance-20261116`
- Initial combined integration SHA: `96e91430d9b12e99b55490b7ca62426d7d5992fc`
- Merge target: `stage3/integration-20261115`
- Contract: `prompts/ENGINEER_5_ROUND_5.md`,
  `docs/23-stage3-round5-integration.md`, issue #22.
- Ownership: QA tests, QA scripts, new QA workflows, release reports only.
  Engine, UI, wire schemas and production game behavior are untouched.

## Reproducible strict gates

Use Node 24.15.0, npm 12.1.0, exact checked-out integration SHA and the
committed package lockfile.

```sh
npm run inst
npx --no-install vitest run --project node \
  tests/e2e/national/IntegratedAcceptance.test.ts \
  tests/qa/national/PacketCanaries.test.ts \
  tests/e2e/national/RoundFiveWarLevy.test.ts
npm run typecheck
npm run lint
npm run format:check
npm run build-prod
node scripts/national-qa/asset-audit.mjs
node --check scripts/national-qa/browser-gameplay.mjs
CHROME_BIN=/usr/bin/google-chrome node scripts/national-qa/browser-gameplay.mjs
CHROME_BIN=/usr/bin/google-chrome node scripts/national-qa/browser-gameplay.mjs --mobile
CHROME_BIN=/usr/bin/google-chrome node scripts/national-qa/browser-gameplay.mjs --legacy
```

Workflow `.github/workflows/national-round5-qa.yml` exercises the
independent real engine, hosted desktop/mobile NATIONAL browser, legacy FFA
browser and audits. **Failed test assertions MUST fail the job**; screenshots
and JSON are uploaded with `if: always()`. A separate inherited baseline CI
must pass **on the exact same integration SHA** before any acceptance.

### Genuine test-failure controls

1. **WAR-01:** live `AttackExecution.init` must refuse an undeclared attack
   _before_ charging real attacker troops. E5 replaces the Game's read-only
   authorization result with `true` in a controlled test fixture and asserts
   the independent authorization oracle detects the violation, then restores
   the real method.
2. **WAR-04:** a formally declared real war must permit a real
   `AttackExecution`; an attack that aborts due to unavailable MDA
   discovery is a failed acceptance, even without active pacts.
3. **LEVY-01/05:** actual defender MDA roster must come from the canonical
   `nationalMdaAllies` port; the test does **not** supply synthetic donors.
   Real `applyNationalDefenseLevy` receipts must equal real contributor
   troop debits. Exact duplicate receipt after snapshot/restore must debit
   neither army. Five continued ticks must maintain identical SHA-256 game
   snapshot digests.
4. **LEVY-05/06:** `PlayerImpl.commitNationalTroopDebits` must reject stale
   balances, duplicate payer rows and reused debits. Test-injected second
   charge is deliberately detected by the independent conservation oracle.
5. **WAR-04 layers:** national and imperial war can coexist; accepting peace
   for imperial war must leave independent national hostilities active,
   including after exact state restoration.
6. **Fog/packets:** existing `PacketCanaries.test.ts` creates a REAL
   `GameRunner` with injected enemy troop, transport and private diplomatic
   canaries. A deliberately tainted output must cause the oracle to throw.
   Revoked principal / unidentified viewer must not see hidden packed fields.
7. **FOG-04 / revoked empire:** `RoundFiveFogRevocation.test.ts` uses
   three real spawned nations, actual empire accession, a hidden-strength
   vessel inherited through allied sight and actual GameRunner packed update
   projection. A deliberately revoked Game authority view must eliminate
   inherited sight and stale memories; restoring a recipient-bound memory
   into an unrelated principal must throw. An actual Game snapshot/restore
   retains its original authoritative political roster, not test-only
   revocation state.
8. **Legacy FFA:** real default FFA preserves prior attack permissions, has
   no NATIONAL political authority, and must not render an active NATIONAL
   diplomacy panel in Chromium.

### Browser stage contract — no fabricated victories

`scripts/national-qa/browser-gameplay.mjs` launches real Vite, development
server and Chromium with CDP, uses **mouse events on rendered controls**,
traverses Lit shadow roots and captures each stage.

Required sequence:
**homepage → Solo → NATIONAL checkbox → Start → active game HUD →
human click-to-spawn → diplomacy panel → Found Empire → E1 accepted
command journal + E3 public worker roster + UI “Confirmed by game” →
genuine E1 rejected command → authenticated save → navigate away →
load same saved game → equal authoritative roster → actual sovereign
victory packet**. Both 1280×800 and 390×844 require success. The browser
harness deliberately rejects transient “Founding request sent” copy.
After genuine accepted founding, E5 submits a deliberately duplicated
`national_found_empire` action through the **existing live client EventBus
and Transport event**, rather than bypassing production authorization or
inventing a rejection; it requires an E1 rejected outcome to travel back to
the same recipient. The harness captures Chromium console exceptions and
failed network loads as separate evidence.

Actual `MessagePort` receive events are instrumented **before app load**;
the test does not alter messages. Evidence contains packet _type, tick,
allowlisted public politics and command outcomes_, not unrestricted private
network payloads. Full screenshots, stage durations, observed packet metadata
and failing controls are included in the workflow artifacts.

**Known portability constraint:** hosted Ubuntu GitHub Actions Chromium
uses software WebGL (SwiftShader); the application deliberately hard-blocks
it with `webgl-gate`. This is a real browser environment **blocker**, not
proof of failed E4 gameplay. The E5 harness reports
`REAL_CHROMIUM_GPU_REQUIRED` when present and preserves screenshots.
Actual complete graphics/gameplay acceptance needs a GPU-accelerated
runner/browser where the game's WebGL2 gate genuinely passes. Do **not**
patch, spoof or hide the application WebGL gate to manufacture success.

**Known save boundary:** worker `snapshot` and `extract_snapshot` are
deliberately denied in NATIONAL because browser-local authoritative memory
contains enemy data. The browser test requires a separately authenticated
trusted-host saved-game flow. It cannot certify restored privacy merely from
a snapshot obtained by a modified local worker.

### First execution evidence (baseline-root source)

[Round Five strict CI run 43917058642](https://github.com/LeviCade/OpenFront-National/actions/runs/43917058642)
executed 14 targeted tests: **12 passed, 2 failed**. Failures:

- WAR-04: formal declaration reached `AttackExecution`, but it aborted with
  `NATIONAL: missing authoritative MDA contributors`.
- LEVY-01/05: `nationalMdaAllies` canonical discovery was undefined.

The first real mobile Chromium run reached Solo, checked NATIONAL, and
clicked Start Game, then detected a nonplayable startup screen; the
next run's screenshot identified the actual **WebGL software renderer
hard block**. Start-screen visibility was not counted as spawned gameplay.

**Regression proof passes:** war-authorization mutation oracle, malformed
and duplicate debit rejection, and legacy direct FFA tests.
**Not yet proven:** positive real WAR attack + MDA donation on the combined
source, browser user spawn, E1/E3 authoritative roster/outcomes in browser,
a real rejected browser command, trusted-host save/reload and browser victory.
All remain blocking, not waived.

## Public-release blockers and security boundary

- **Issue #5:** protected upstream `/proprietary` assets excluded, but 40
  font/audio candidates still need manual provenance, licensing, attribution
  and runtime network-asset inspection. Automated hash inventory is not
  legal clearance.
- **Issue #6:** independent prior run recorded **17 dependency advisories**
  overall, including **7 production-tree** (2 critical, 3 high, 2 moderate).
  Treat them as untriaged potential exposure; never mass-upgrade packages to
  silence the count without review.
- **Trusted authority:** the entire current NATIONAL simulation runs in the
  user's own browser. Packet filtering protects the **honest Solo client**;
  a malicious browser can inspect real authoritative worker memory. This
  architecture does **not** guarantee competitive multiplayer secrecy.
  A separate server-trusted authority is required before hostile-client PvP.

## Acceptance and handoff

Conductor must examine the exact integration HEAD, replay/SHA-256 and packet
artifacts, a real GPU-backed end-to-end Chromium recording, war/levy resource
conservation, manual licensing and security triage, and independent E1/E2/E3/E4
changes. A green PR or direct-game test alone cannot certify a playable
NATIONAL browser game. The E5 PR must stay **unmerged/unapproved for release**
until the gating differences are reconciled; QA tests should be adjusted to
the verified canonical interfaces, never weakened to match incomplete
behavior.
