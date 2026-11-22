# E2 operator contract — isolated local NATIONAL staging

This is **local staging identity**, not OpenFront upstream OAuth, delivered email, real Turnstile, external TLS/WSS, or independent human acceptance. Never expose its localhost listeners or state directory over a tunnel or proxy. The application retains its ordinary signed-account gate. The pre-existing development first-join Turnstile omission is explicitly not attestation.

## Browser operator (E5)

Use a fresh disposable checkout of E2's exact reviewed PR head, Node 24.15, npm 12.1, no dotenv overrides, and the normal repository dependency installation:

```sh
npm run inst
node scripts/national-staging/start-local.mjs
```

The foreground supervisor registers three separate local records, starts the actual identity, Master, Worker and Vite processes, and verifies the exact commit appears in the actual browser bootstrap. The only browser origin is http://localhost:9000; identity localhost:8787; Master localhost:3000; Worker localhost:3001. No operator API key or account tokens appear in supervisor output. Use three separate fresh browser profiles, not shared tabs or copied cookies. In each application's normal account UI request a magic link for that participant's registered @staging.invalid address. A private operator terminal (command printed at startup) reads only that mailbox. Open its generated link in the intended profile and use the normal account UI and private NATIONAL lobby controls. Do not paste links into issues, CI, chat, screenshots or recordings.

The supervisor's local mail delivery is the credential possession boundary. The operator controls each private mailbox; this is not validation of a third-party email address. Actual refresh cookies are Secure, HttpOnly, SameSite=Strict; localhost is the development secure-context exception. A new login or refresh is performed by the browser's ordinary application flow. No browser cookie injection or manufactured tokens. Ctrl+C terminates its owned process groups and removes disposable identity state. Do not use `npm run dev` because that starts the default DEV-commit Worker and warning API key.

## Executable evidence

```sh
node scripts/national-staging/identity-check.mjs
node --import tsx scripts/national-staging/worker-journey.mjs
node scripts/national-staging/browser-auth-check.mjs # requires google-chrome, disposable CPU runner
npx --no-install vitest run --project node tests/server/NationalAccountLease.test.ts tests/national/TrustedNationalServerAuthority.test.ts
```

Run each separately with ports free. The journey uses actual HTTP auth exchange and native binary WebSocket protocol participants, not independent humans. No snapshots, turns, credentials or hidden projections are logged. Only stage markers, aggregate counts and sanitized connection/tick diagnostics. The separate Chromium check uses three fresh profiles, actual UI clicks, ordinary login-link navigation and real secure cookie refresh on reload. It does not claim multiplayer rendering or independently witnessed human interaction. Workflow: .github/workflows/national-c4-e2-operational.yml. Exact-source evidence is stamped at execution.

## Authority and failure

- Current socket, signed subject and account API public ID bind the seat. Revalidation polls every 10 seconds, plus at most the account client's 5-second upstream response deadline; token expiry has an independent timer. A disconnected/replaced socket cannot use the current socket's authority. Revoke pending commands and recipient capability before closing the peer.
- A live account API rejection or ban loses authority; transient outage or access expiry is retryable using existing reauthentication/reconnect mechanics. In a started match the original seat remains reserved. An unstarted private lobby retains existing host-leave semantics: the lobby ends if the host leaves.
- Each projection carries only the authenticated seat's own canonical engine identity metadata, including before spawn and on refresh/reconnect; other lobby seat IDs and pre-spawn private resources remain excluded.
- NATIONAL remains unlisted private FFA; no spectator player-authority toggle. No distributed lease or game snapshot restoration is claimed. Master/Worker ownership is single local process per port. Loss of the authoritative process terminates the match. No recovery route restores a dead match from browser data; old game IDs are not intentionally reused. The restart journey checks missing old game, rejected old rejoin, and new game ID. Distributed failover needs a durable authoritative ownership/fencing mechanism and E1 canonical snapshot contract.

External prerequisites: explicit operator authorization for staging identity issuer, audience, JWKS and account lookup; real browser login credentials in private custody; approved HTTPS/WSS ingress and production-grade challenge verification. E5 independent physical human observation and E6 hardware evidence remain separate.
