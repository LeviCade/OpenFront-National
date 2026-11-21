# CLASS FOUR / E6 — physical Skybot witness adapter

**Owner:** Engineer #6 · [Issue #68](https://github.com/LeviCade/OpenFront-National/issues/68) · **official completion: 40%**.

**Result: source integration implemented; physical release certification BLOCKED.**
No physical host shell, root-only attestation key, independent controller
observation channel, or signed post-termination cleanup receipt was made
available to this engineering session. No GPU job was dispatched.

## Current physical-controller boundary

The actual `LeviCade/Skybot-CI` main source already has substantial
production controls. The Go scaler's `gpu_job_authorization.go` obtains
current GitHub workflow run/attempt and initiating actor permissions before
GPU admission. `controller/runner.go` retains numeric JIT runner identity.
`controller/provisioner/libvirt/libvirt.go` confirms VM absence before
deleting RAM overlays. The root socket broker
`scripts/host-gpu-broker.py` checks physical Intel render node, device,
root-owned GPU ACL lease, and the approved `libvirt-qemu` ACL. Its
`GRANT/RELEASE/CHECK` contract is **not** an Ed25519 release-signing
service. Neither GPU renderer strings nor a successful Actions job are
host cleanup receipts.

## Implemented host adapter

`scripts/national-gpu-ci/skybot-host-witness.mjs` has two explicit
phases, `preflight` and `postflight`, designed for installation by
the real privileged Skybot controller/operator on its **physical Linux
host**, never in a KVM guest. It has no key-generation or key-enrollment
function.

The adapter independently queries GitHub's repository, workflow run,
specific job, initiator collaborator permissions, reviewed Class Four
staging ref and candidate ancestry. It refuses a mismatched immutable
repository ID, SHA, run, attempt, **job ID**, actual numeric runner ID,
runner name, initiating writer, nonce or reviewed staging tip. A rerun
checks the `triggering_actor` rather than the original actor. A job
`runs-on` label alone does not satisfy runner identity.

The host-side `preflight` checks physical vendor `8086`, device
`0412`, `i915`, `/dev/dri/renderD128`, a root-owned mode-0600
GPU lease, its exact contents, active `libvirt-qemu` ACL, and an actual
matching KVM/GL domain. It additionally **requires** a root-only
`controller-gpu-observation.json` from an independently approved
out-of-guest browser GPU observer. An `observedByController` field in
an arbitrary guest JSON file is not proof; this file's producer must be
reviewed and live on the host controller. Without it **NO signature**.

The `postflight` requires GitHub's completed job timestamp, libvirt
domain absence, lease disappearance including dangling symlinks, revoked
ACL, verified `tmpfs` overlay mount and absence of exact runner QCOW2
and EFI files. The independent controller must also provide a root-only
`controller-teardown-observation.json` showing actual host cleanup,
private log destruction, restored CPU capacity and runner deregistration.
GitHub's repository-scoped runner inventory must independently confirm
the numeric JIT runner is gone; incomplete pagination or missing API
access blocks signing. No guest self-deletion qualifies as host cleanup.

Only after those checks does the host adapter sign the exact
`release/summary.json` SHA-256 and all ten cleanup facts as
`skybot-gpu-postflight-v1`. The adapter immediately runs the existing
E6 off-guest `verifyIndependentRelease` against all four actual
reports and source-bound PNG manifests. Signed **FAILED GAMEPLAY**
is still rejected; signing a teardown receipt does not make a game pass.

All signatures use Ed25519 over UTF-8 `JSON.stringify(payload)`.
The signer requires **both** independent enrollments: the reviewed
`scripts/national-qa/trusted-gpu-keys.json` fingerprint and a
root-owned host policy. It will never generate or automatically enroll
a key. The Class Four verifier now additionally binds exact `jobId`
in preflight, postflight and the trusted context.

## Required host-controlled inputs

The physical operator must provision an approved source-pinned copy of
the host adapter (root owner, mode 0600) and root-only directory
`/etc/skybot-ci/national-gpu-release` (owner root:root, mode 0700).
Each root-owned input must be a regular mode-0600 file:

- `trusted-github-run-context.json`: repository ID/name, approved
  Conductor candidate SHA, reviewed staging ref and exact tip SHA,
  run ID/attempt, job ID, assigned runner name/ID, fresh random 64-hex
  challenge. The context must originate from the controller's
  authenticated GitHub admission and reviewed exact source, not
  `github.env` or a guest file.
- `github-token`: host-only narrowly scoped token able to read repo,
  run/job, collaborator permissions, staging compare and JIT runner
  registry. Do not publish or copy the token into the guest.
- `controller-ed25519-private.pem`, `host-public-key.pem`, and
  `host-trust-policy.json`: out-of-guest key and approved fingerprint.
  **No enrolled key exists in E5 yet.**
- `controller-gpu-observation.json`: host-controller-brokered
  live WebGL1/WebGL2 renderer/shader observation, exact SHA/run/
  job/runner/nonce, independently corroborated against the physical
  GPU and actual registered guest. A guest-generated fixture alone
  is explicitly insufficient.
- `controller-teardown-observation.json`: physical post-run
  host-only runner/lease/VM/process/log/capacity verification.
- `verified-artifacts/summary.json` and the four sanitized
  per-mode PNG/report paths, securely fetched and staged **outside**
  the guest. The exact summary bytes are signed. Raw private
  packets and logs must never be included.

The private key and token are kept entirely off-guest. The out-of-guest
observations and private key must be bound by a privileged root-owned
service, with a strict policy prohibiting host filesystem mounts in the
KVM runner. The adapter is deliberately not executable by GitHub Actions.

### Missing actual-controller wiring

Skybot currently offers `GRANT/RELEASE/CHECK` on its root GPU
broker—not an authenticated host Ed25519 signing endpoint. A privileged
operator must review/install a new controller-owned service or hooks to
produce both observation files, manage key enrollment, issue a fresh
one-time nonce, and deliver only **short-lived signed PUBLIC preflight
data** to E5 through a verified read-only channel. E5 checks preflight
freshness on every browser invocation (maximum 120 seconds), so its
four serial modes need independently refreshed controller proof;
copying one expired proof cannot work. The host must never export the
private key, broader controller token or root telemetry to the guest.

A true three-principal browser test additionally needs E2's authentic
shared NATIONAL multiplayer server and three separate authorized
Chrome user-data profiles on the **same GPU guest**, in the same
authoritative game ID. E5's `NATIONAL_QA_PEER_CDP_PORT` is for the
accession recipient; `NATIONAL_QA_PEACE_CDP_PORT` is for a separate
outside-empire war opponent. Local CDP ports must not be exposed over
the WAN, and no cloned tokens, invented browser principals or guest
state mutations can count as acceptance.

## Source gates, artifacts, and verdict

`skybot-host-witness.test.mjs` exercises source SHA/run/attempt/
job/runner/nonce mismatches, unauthorized initiating identities,
stale staging, missing host observation, all controller teardown
requirements, Ed25519 signatures, independent fingerprint enrollment
and byte-exact evidence hashing. Tests use **synthetic fixtures only**.

The reviewed default-main hardware workflow now accepts the exact
head of `stage3/class4-six-owner-reciprocal-20261121`, not an
older R10 staging ancestor. It retains one GPU allocation, one
dependency installation, four sequential browser scenarios and
bounded 14-day GitHub-native artifacts. The repository is public;
private Drive federation remains prohibited.

**Trustworthy outcome today: SOURCE-ONLY. Physical key enrollment,
controller observer and cleanup-signing deployment, independent
guest proof delivery, and actual shared multiplayer admission are
unverified. Public release approval is BLOCKED.**
