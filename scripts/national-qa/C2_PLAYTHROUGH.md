# 🛡️ C2 First Class / E5 independent real-browser playthrough

**Founding commit:** `2cfe3d4f91f28df61c7ebd7c429c9fdca674daf0`  
**Integration target:** `stage3/conductor2-class1-engineering-20261121`  
**Manager-certified completion:** **41%**, unchanged by E5 source checks.

This is a three-lane QA plan; **source unit tests and software Chromium
are never evidence of authorized physical GPU gameplay**.

## Exactly one verified source per run

Use Node 24.15.0, npm 12.1.0 and `npm run inst`. Checkout the
Conductor-approved **exact merged SHA** and configure
`NATIONAL_GPU_CANDIDATE_SHA=$(git rev-parse HEAD)`. The runner refuses a
different checked-out SHA. E5 never dispatches a physical Skybot run.

### NATIONAL Solo desktop and mobile (genuine CDP)

```bash
node scripts/national-qa/browser-c2-run.mjs --mode national-solo-desktop
node scripts/national-qa/browser-c2-run.mjs --mode national-solo-mobile
```

Both call `browser-gameplay.mjs --solo`, not the previous full multiplayer
scenario. No B/C, accession, crown, or opposing-human peace is required for
**Solo**. Genuine keyboard/pointer/touch and current GameView/Worker data must
prove: game admission, live ticks (not 00:00 HUD), unobstructed map spawn,
founding request/receipt/current roster, real WAR request/receipt,
territory-targeted native radial Attack, correlated outgoing engine attack and
actual target troop/territory loss. Screenshot evidence must include valid PNG
bytes; an in-memory screenshot event alone does not pass.

### Real three-browser Private NATIONAL

```bash
NATIONAL_QA_PRIVATE_CDP_PORTS=9222,9223,9224 \
  node scripts/national-qa/browser-c2-run.mjs --mode private-national
```

Each CDP port **must already represent an independently logged-in human**
using the actual E2 host. E5 **never creates identities, sets cookies, opens
Solo stand-ins or injects game state**. The current readiness probe is
read-only and deliberately returns **BLOCKED** until host-origin seat
admission, independent recipient projections, authoritative server tick,
E4 live gameplay controls, bilateral accession consent, WAR/peace, reconnect,
spectator denial and E6 independent host proof are observed. Identical
browser-reported match IDs alone do not prove one trusted server. E4 should
provide a read-only *non-secret* projection marker for diagnosis; the marker
is **not** itself authentication.

### Legacy desktop and mobile regression

```bash
node scripts/national-qa/browser-c2-run.mjs --mode legacy-desktop
node scripts/national-qa/browser-c2-run.mjs --mode legacy-mobile
```

Each starts real legacy Solo FFA, proves NATIONAL UI is absent, and requires
real map input followed by live worker territory/attack updates and positive
owned tiles. A rendered menu or screenshot is not enough.

### Optional ordinary Chromium smoke, NEVER physical GPU acceptance

On an ordinary Ubuntu development runner with a locally installed
`google-chrome`, `NATIONAL_QA_SOFTWARE_CDP=1` can diagnose JavaScript,
DOM, engine and first-failure stages. **SwiftShader may be blocked by the
normal game's WebGL gate. This result MUST remain FAIL or BLOCKED.**

The E6 physical lane is different: the Conductor must first review and
approve the exact changed merged SHA; E6 then provisions its privileged
Skybot runner and independent signed host witness. Only an independently
verified host **preflight + postflight + evidence digest** can certify a
physical run, after all four actual browser modes succeed. E5 does not
accept browser-supplied self-attestation.

## Evidence handling

`national-qa-artifacts/c2/<mode>.json` contains a bounded machine-readable
`PASS/FAIL/BLOCKED` gameplay verdict, first failure/owner, expected source,
per-mode screenshots, sanitized WebGL shader and packet counts and
`hardware: BLOCKED` until E6 separately authorizes/certifies. The local
`private-logs` and raw image folders are **private**; do not upload login
tokens, private invitations, raw websocket frames or recipient-specific
screenshots to public CI. Use the E6-owned artifact sanitizer for approved
hardware runs.

**Baseline known from earlier hardware diagnostics, different SHA:**
NATIONAL desktop founding failed; NATIONAL mobile spawn failed; legacy
desktop/mobile exited zero. No new physical GPU result is implied by this
document or the negative-control tests. Preserve those first failures until
E6's reviewed changed-head test records actual success.

**Owner-routing:** E1 commands, WAR and peace semantics; E2 authenticated
host/socket/ticks/reconnect/spectator; E3 private recipient DTOs; E4 map
projection, pointer/touch, viewport and controls; E5 browser harness,
screenshots/first failure; E6 physical GPU, host signatures and release gate.
