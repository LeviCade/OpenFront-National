# C4 Class 2 – physical run approval (not a certificate)

Only the independently reviewed final tip of `stage3/conductor4-class2-integration-20261122` is eligible in this class. Neither a founding SHA nor an engineer branch is approval. No key has been enrolled or host modified by this PR.

## Two distinct operator approvals

1. Independent operator reviews collective source, installs reviewed host scripts (including host-run-grant.mjs, root-owned and not guest-controlled), verifies host isolation and signer enrollment, and sets root-only approved-candidate.json to the reviewed exact SHA/ref.
2. Authorized owner dispatches the approved stage with candidate_sha equal to its tip. The controller's live API verification stages exact run, attempt, assigned job, runner and random challenge in trusted-github-run-context.json. This is not acceptance.
3. Before the first HSM call, an independent operator reviews that context and live job, then creates **approved-physical-run.json** in the existing root-only release directory, root:root 0600, outside the repository and guest. No automatic generation. Set kind to skybot-physical-run-grant-v1; workflow to .github/workflows/national-hardware-acceptance.yml; physicalMode to four-mode-release; modes to the ordered array national-desktop, national-mobile, legacy-desktop, legacy-mobile. Pin repository, repositoryId, sourceSha, approvedStagingRef, approvedStagingSha, runId, runAttempt, jobId, runnerId, runnerName, challenge as exact strings from independently verified context. Set integer issuedAtMs and expiresAtMs from trusted UTC host clock; issuance cannot predate job start, expiry must be within two hours of job start.
4. Sign only observed modes; first preflight requires national-desktop, subsequent refreshes require a later mode. The signer rechecks grant validity immediately before HSM use and reserves each signing slot once. Missing/expired/mismatched grant, a duplicate reservation, or a interrupted partial write is fail-closed; quarantine and independently reconcile the session, do not retry by deleting a reservation. Independent observation must prove the actual checkout SHA, renderer and WebGL. Postflight requires completed exact successful job, four distinct valid proofs, authenticated custody and observed teardown as before.
5. Archive signed records and independent evidence privately. No automatic rotation, trust provisioning or deployment. An operator-owned physical browser functional witness may be useful separately; never label it as a signed formal release. A source-only check is not physical execution.

This is an additional control, not a replacement for live control-plane and physical verification. The reviewable grant is issued after the job is assigned because ephemeral runner ID and job ID are unknown before scheduling. Do not publish grant/challenge or host credentials in GitHub comments.

Local source checks: node --test scripts/national-gpu-ci/host-run-grant.check.mjs scripts/national-gpu-ci/verify-workflow.mjs. The private operator preflight is a separate reviewed infrastructure change.

## Separate owner-functional witness (no Skybot acceptance)

On an authorized owner-controlled physical machine, independently inspect the actual GPU device, use a fresh detached checkout of the approved collective staging SHA with dependencies installed and a reviewed real Chromium executable, and invoke:

```sh
CHROME_BIN=/absolute/path/to/real/chromium node scripts/national-gpu-ci/owner-functional-witness.mjs APPROVED_FINAL_SHA
```

This local tool checks the official live staging ref, exact tracked checkout and absence of stale report directory; runs explicit NATIONAL Solo desktop/mobile (`--solo`) and Legacy FFA desktop/mobile, without requesting signed-hardware mode or enabling software CDP; requires real renderer and both shader pixels and authentic E5 gameplay success events. It rejects software/ambiguous renderers, incomplete phases, stale reports and wrong source. It writes an immutable local owner-functional summary. It does NOT independently attest physical inventory, provide a second witness, certify GPU hardware, prove a win, sign a preflight, upload artifacts, or verify teardown. Browser-provided observation is not an independent host observation. Independent operator review and E5's separate end-to-end victory/Private witness remain mandatory.

Integration warning: at founding SHA, browser-gameplay.mjs checks PEM text instead of canonical DER fingerprint and the formal four-mode runner invokes the three-principal path. E5 and Conductor must reconcile those contracts before formal dispatch; this local functional lane does not weaken the existing signed release gate.

The second source revision cryptographically binds the exact approved grant digest to every signed record and checks previously signed ordered mode prefixes before invoking the HSM. The standalone verifier requires the same root-owned policy digest. Reservation publication uses no-overwrite atomic linking and fsync before any HSM invocation. A changed grant or incomplete reservation is quarantined, not automatically refreshed.

## Exact four-mode Class Two contract

The signed lane explicitly runs NATIONAL Solo desktop/mobile and Legacy FFA desktop/mobile. It requires authoritative Solo founding, real opponent damage and a final Solo receipt, or Legacy actual map interaction; it rejects wrong scenario kind, duplicate/missing completion, errors and missing final screenshot. The inherited unsigned three-principal diagnostic remains separate and unchanged in gameplay requirements. This is a hardware-and-observed-playability certificate only: a completed sovereign victory, independently witnessed Private multiplayer, and wider application release approval remain separate E5 gates. Each mode validates the actual checkout before and after execution, the live GitHub job identity, fresh signed grant-bound evidence, canonical Ed25519 SPKI enrollment, and real WebGL. No independent trust anchor was enrolled by this change.
