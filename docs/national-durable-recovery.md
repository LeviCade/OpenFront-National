# C4 Class 2 E2 — durable Private NATIONAL recovery operator contract

## Scope and failure model

This option is **same Linux host, same private local filesystem, same shard
topology, same exact source commit and canonical map assets**. It is not
distributed consensus, a remote failover mechanism, a backup service or
disaster recovery for destroyed storage. The filesystem must honor SQLite's
locking and fsync requirements. Never mount the same recovery volume across
hosts or replace, remove, or rename the live lock/database paths. Do not use
NFS/SMB, ephemeral volumes or network-backed overlay storage.

The authoritative Worker holds a kernel flock for its shard until process
exit. No timer or renewable remote lease permits a second writer. An explicit
one-time initializer provisions the private directory, databases, locks and
topology manifest. Worker startup does not create missing stores. Failed
validation prevents the listener from becoming available. A failed commit
fences the writer, ends the running instance and preserves the prior checkpoint.

## Acknowledgment contract

Every committed turn, including an empty turn, is a complete engine snapshot
at the deterministic tick boundary. Recipient projections are collected
synchronously, the snapshot and command-owner state are committed using a
SQLite FULL-synchronous rollback transaction, then packets are emitted. The
genesis record precedes start publication. The target loss window is zero
**acknowledged committed ticks**; an interrupted transaction cannot become a
valid generation, and an already committed but undelivered tick may survive.
There is no journal replay; replay length is zero. Request IDs are reserved in
durable state before queue admission. Pending physical-socket-owned commands
are canceled on process loss; reserved IDs are not released for another
principal or revived. Requests with no ID do not acquire retry idempotence.
The checkpoint also records kick/pause controls, immutable account-to-seat
bindings and rolling turn commitment. Normal deliberate end retires the row;
a failed durable tick does not retire it.

Storage limits: 16 matches per shard, 64 MiB maximum serialized record, 1 GiB
SQLite page cap, at most 100,000 request IDs and 4,096 pending client intents
per match. The rollback journal requires additional temporary space. Reserve
at least 3 GiB per worker plus operational margin; measure actual workload,
snapshot CPU, fsync latency and maximum supported map/match size before rollout.
Do not claim arbitrary-map throughput. The existing engine snapshot contract
documents a water-nuke graph timing limitation; E2 does not claim universal
determinism beyond what the engine can roundtrip and advance faithfully.

On restoration the original engine players are reconstructed as disconnected
seats, without JWT, service keys, session cookies or old sockets. A new
connection must pass existing live account validation, stable subject and
account ID checks, ban and lease checks. No recipient is activated until then.
The first verified rejoin permits the restored simulation to advance; an
unclaimed recovered match retains the existing empty-game grace and original
maximum lifetime. Recipient streams and delivery cursors are fresh.

## Independent E5 witness: disposable localhost only

Use Linux with Node 24.15.0, npm 12.1.0, git, util-linux flock and the existing
project dependencies. Use a disposable checkout of the final reviewed
candidate SHA, not a floating branch. No dotenv files, existing production
keys, external accounts or ports occupied by unrelated services.

```sh
git checkout --detach '<exact reviewed SHA>'
git rev-parse HEAD
node --version
npm install --global --ignore-scripts npm@12.1.0
npm run inst
node --experimental-strip-types scripts/national-staging/durable-store.test.mjs
NATIONAL_TEST_DURABLE_RECOVERY=1 node --import tsx scripts/national-staging/worker-journey.mjs
```

The journey generates separate local identity state and four ordinary accounts
(three seats plus a foreign principal), uses the application Master/Worker,
localhost identity service, actual authenticated WebSockets and native wire
encoding, forms pacts and empires, creates an imperial war and pending peace
motion, and kills its **own** detached process group with SIGKILL. It never
kills arbitrary ports or other hosts. It compares a read-only independent
SQLite checksum to the replacement Worker commitment before authentication,
tests refusal of competing and incompatible Workers, denies banned, foreign,
spectator and unavailable-identity clients, obtains three fresh account
sessions, rebinds the original engine seats, tests fresh recipient streams and
old request rejection, and attempts settlement of the preserved motion.

Require exit code zero and both `DURABLE_RECOVERY_EVIDENCE` and
`restart_recovery=1`. The default non-durable journey deliberately reports
`restart_recovery=0` and is not evidence of this objective. An explicit refusal,
timeout, crash, or missing marker fails acceptance. Record the original and
recovered game IDs, last committed and durable ticks, restored and advancing
ticks, checkpoint and replay digests, elapsed times, loss window, three
reverified seats and duplicate-timeline witness. Do not publish raw snapshot
bytes, account subjects, cookies or JWTs. This is an automated account witness,
not three independently witnessed human users.

## Authorized deployment prerequisites

The root must be a newly provisioned, operator-owned absolute canonical path;
its parent must exist. Initialize exactly once while all Workers are stopped:

```sh
export NATIONAL_RECOVERY_ROOT=/absolute/private/operator-managed/world-store
export NUM_WORKERS=1 # or the existing approved, immutable shard count
node --experimental-strip-types scripts/national-staging/init-durable-world.mjs "$NATIONAL_RECOVERY_ROOT" "$NUM_WORKERS"
export GIT_COMMIT="$(git rev-parse HEAD)"
```

Use the same root, worker count, instance routing and exact build on all
restarts. Do not reinitialize if recovery refuses. Diagnose offline; preserve
the original store and use isolated copies for fault injection. Existing
deployment orchestration must supervise the approved Master and Workers, route
only after recovery readiness, and retain the private volume. Never expose the
store by static serving, HTTP download, browser payload, or client path.

External staging requires independently authorized DNS/HTTPS/WSS ingress,
operator-provided production-style domain/instance routing (`DOMAIN`,
`GAME_DOMAIN`, `INSTANCE_LETTER`, `NUM_WORKERS`), exact `GIT_COMMIT`, the approved
identity/API configuration and service `API_KEY` provided out of band, a real
`TURNSTILE_SITE_KEY` and upstream verification, actual provider OAuth accounts,
and fresh JWT/JWKS and /users/@me validation through the normal application
flow. Disable `NATIONAL_LOCAL_STAGING` outside the isolated localhost harness.
Never use the harness's test Turnstile key or localhost identity as evidence
of external authentication. Verify actual certificate trust, secure websocket
transport, revocation, stable authenticated seat binding and restart on the
authorized host. No such external access is asserted by this change.
