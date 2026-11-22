# C4 E5: independent gameplay assessment

Founding source: `7ba909572739bd0778c9cf34074008f1bf244124`. See sibling JSON for exact per-lane artifact archive SHA-256 (GitHub metadata plus upload logs), URL, environment, first failure, owners and reproducer. The ZIPs were not independently downloaded and rehashed here.

**0/5 gameplay PASS, 4 FAIL, 1 BLOCKED.** Physical certification BLOCKED. Source run 44974332727: 825 files, 11,797 tests passed, one skipped, typecheck, lint and production compile passed; inherited format gate failed on E1/E4 workflow and E2 host document. No actual game conclusion, real attack, canonical combat or three authenticated sessions witnessed.

## New executable oracle

`c4-journey-semantics.mjs` and `c4-journey-evidence.mjs` add a stricter, separate evidence consumer. Existing C2/C3 diagnostic collection remains intact. This is NOT an actual gameplay producer. Current C2 runner cannot supply complete C4 evidence; upstream E1/E2/E4 instrumentation and authorized execution remain necessary. No release should rely on the old damage-only summary.

The caller must independently pin browser/authority JSON byte SHA-256 and the trusted execution context (source, match, runner, renderer, host/auth kind). A guest must not supply its own trust root. The semantic oracle checks ordered measured state transitions, unique request IDs and receipts, advancing ticks, actor/target correlation, rejected commands without effects, constitutional sole-sovereign win and three independent recipient projections/profiles. The adapter verifies PNG bytes with inherited CRC and decoded scanline checker plus per-stage hashes. Physical results are a distinct E6 external verified artifact; the adapter does not sign or independently authenticate E6's keys and returns releaseCertified=false even for a correlated package. No synthetic fixture passes real gameplay.

Reproduce new controls with pinned Node/npm via `npx --no-install vitest run --project node tests/e2e/national/C4IndependentJourneyEvidence.test.mjs`. Strict audit workflow runs real npm audit and asset inventory and deliberately reports failure when release gates are unresolved.

## Ownership / unblock

E1: canonical actual receipts/measurements for spawn, admission (D-013), war/attack (D-014), illegal denial (COAL-05/WAR-01), scoped peace (WAR-04/09), crown transfer (SOV-04), sole sovereign (SOV-01/03).

E2: supported real login, same host/game/runner, three independently registered principals, separate profiles, reconnect, cross-principal/stale/replayed/spectator negative receipts. Distinguish local registration from external provider and human participation. No secrets or raw private projections in public artifacts.

E3/E4: independently observed recipient-specific sanitized projection digests, actual browser mouse/touch and rendering, current legal targets and revocation. E6: approved real host access and exact independently verified pre/postflight signer chain. E5: correlate without altering gameplay.

#5: strict run 44975025594 checked 12 known shell files successfully; 40 media origin reviews (2 fonts, 38 audio) and four missing music resources still block release. Directory license is not individual media-origin clearance.

#6: exact same-lockfile audit on `23f744402a6678c4b77a66af841493fea226318a` reports **zero production-tree advisories** and ten dev-only candidate packages: critical `concurrently`, `shell-quote`; high `brace-expansion`, `source-map-js`, `undici`, `vite`; moderate `@vitest/coverage-v8`, `@vitest/mocker`, `@vitest/ui`, `vitest`. All list fixes available. Risk remains in build, CI and developer environments; this is not an exploitability determination. Strict audit failed as required. No remediation claimed.

Audit archive 14735475520, SHA-256 `ffe932cd49f342f23fa12df4ff4a3395057a0ac8d6eec59b54d52317ab0cb8c5`.

Exact source control job 137062878651: 20 new controls and 53 total tests passed, lint zero errors, formatter failed on three new files; the following commit applies the exact CI-generated formatter patch.
