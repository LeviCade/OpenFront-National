# C3 Class 1 E2 — Private NATIONAL real-browser host contract

Founding: `ea186fa2580c5e1112e36cf1ddaa9119566a2abe`. Branch: `feature/c3-class1-e2-real-browser-auth-host-20261121`. Staging: `stage3/conductor3-class1-integration-20261121`.

## Truth boundary

C2 `TrustedNationalRealWebSocket.test.ts` verifies three separately signed Ed25519 JWTs and crosses localhost TCP/WebSocket into one GameRunner, but its account directory is a fixture. It is **NOT** proof of live account authentication. The current class refuses Dev persistent IDs and guest tokens for NATIONAL; Worker must validate the signed provider plus a _fresh_ `/users/@me` response at creation, joining and reconnect. No external account login, deployed live host, real GPU, or crash-safe match persistence has been witnessed in this class.

## Authorized nonproduction host runbook

1. Provision an isolated, firewalled, disposable environment with an authorized identity API supporting real app account login, `/auth/refresh`, `/.well-known/jwks.json`, `/users/@me` and `/join_verify`. Match JWT issuer, Ed25519 JWKS and audience to the Worker `DOMAIN`; keep `API_KEY` server-side and use only staging credentials. In Dev `DOMAIN=localhost` points the account API to `http://localhost:8787`; `npm run dev` alone DOES NOT start that API.
2. Pin this feature branch's exact HEAD. Run `npm ci`, `npm run format:check`, `npm run lint`, `npx tsc --noEmit`, then `npx vitest run --project node tests/server/NationalAccountGate.test.ts tests/server/TrustedNationalRealWebSocket.test.ts tests/national/ClassFiveTrustedLobbyTransport.test.ts`. Source tests are not browser acceptance.
3. For a protected LAN test, use the repo's existing `npm run dev:host`, worker ports 3001+ and matching Vite worker-index proxy ONLY with a reachable approved local identity API. Do not expose the Dev Worker externally. For remote A/B/C browsers, deploy HTTPS/WSS through an approved staging reverse proxy, configure OAuth redirects, NAT and access controls. Keep the host's `GIT_COMMIT` equal to the deployed source SHA.
4. A/B/C must sign in through the supported application UI in three separate browser profiles using three **distinct real accounts**; never copy cookies, JWTs, or fabricate browser auth state. Verify each profile's session against the real account backend without printing private responses.
5. A creates an unlisted Private FFA lobby and selects **Private NATIONAL — signed-in accounts only (experimental)** in the non-production Host modal. Verify server `gameConfig.nationalMode=true` rather than relying on checkbox appearance. An alternative trusted-host API path is `POST /api/create_game` with body `{"nationalMode":true}` and A's legitimate fresh Authorization bearer, producing default Private FFA with bots disabled. Never publish or log that bearer.
6. B/C join exactly A's lobby, then A starts. The trusted GameServer must show one game ID, one `TrustedNationalMatch` and one server-owned GameRunner, three distinct JWT subjects and API publicIds, per-account `national_start` and advancing `national_projection` ticks. All three perform normal map spawn, lawful political commands and observe authorized per-recipient receipts. E1 owns WAR/Attack outcomes; E3 owns observer fog; E4 owns real visible controls.
7. Reconnect B with its supported login; verify same authoritative seat, new socket-bound recipient registration, revoked pending commands and uninterrupted A/C tick progression. Negative cases: B token reused for D seat, expired/revoked JWT, superseded socket intents, spectator commands, command replay, forged actor ID and private projection delivery to nonrecipients. A crashed host loses its current in-memory game: do NOT report restart continuity PASS or pretend a newly created game is the same runner.

## Host-side source evidence (no principal secrets)

The actual GameServer writes `NATIONAL authoritative host ready` exactly once per successful match creation with `authenticatedSeats`, `distinctAccounts`, `authoritativeRunners: 1`, and `initialTick`. It also writes `NATIONAL authoritative tick` for every hundredth server tick and on queued intents, with tick, queued intent count, and a truncated deterministic replay commitment. `NATIONAL authenticated socket resumed` marks a successful account-verified replacement. E5 must compare these host-side lines to browser frame types and monotonic ticks on the same game ID. **Queued intents do NOT establish lawful acceptance**: only E1's authenticated recipient-bound engine receipt does.

## E5 decision

**PASS:** independent three real-account browser sign-ins, same Worker/game ID, legal spawns/actions, authoritative advancing ticks, recipient-safe private projections, lawful reconnect and negative abuse tests on an exact pinned HEAD.

**BLOCKED:** missing identity API, three real account credentials, Turnstile, staging network/TLS/host, map assets, approved GPU or real client. Name the missing prerequisite; a fixture-only success remains BLOCKED for real-account play.

**FAIL:** any cross-principal seat theft, replayed forbidden command, unauthorized private projection, duplicate authoritative runner or forged host evidence.

Evidence must include exact source SHA, host-side anonymous seat counts, typed frame names, tick deltas, command result summaries and redacted failure reasons. Never upload raw private socket packets, bearer tokens, `/users/@me` bodies or other private principal data.

## Interfaces

- E1: the single canonical GameRunner and political authority determine command validity, not a browser-emitted success.
- E3: `TrustedNationalMatch` binds each recipient to its admitted physical socket and rotates sessionId on rejoin.
- E4: use the new nonproduction Host toggle plus the existing `national_start` / `national_projection` client protocol; never simulate a second GameRunner.
- E5: independent three real-browser path; PASS/BLOCKED under the criteria above. Build hashes and host logs must agree.
- E6: physical GPU attestation is independent and remains BLOCKED without a real root/signed runner witness.
