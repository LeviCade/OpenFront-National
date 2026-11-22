# Third Conductor / First Class / Engineer #6 — physical Skybot GPU gate

**VERDICT: BLOCKED.** Source hardening is not a hardware certificate.
OpenFront founding commit: `ea186fa2580c5e1112e36cf1ddaa9119566a2abe`.
Approval target: `stage3/conductor3-class1-integration-20261121`.
Skybot dependencies: [#248](https://github.com/LeviCade/Skybot-CI/pull/248) and [#249](https://github.com/LeviCade/Skybot-CI/pull/249), both unmerged at initial audit.

## Independent release gate

1. An **authorized root operator** must inspect the physical Linux GPU hypervisor, actual libvirt VM, render node, GPU lease and ACL. GitHub permission is not host authority.
2. Independently review/merge the private Skybot controller and inspect/install the root-owned witness systemd socket/service; the Go/Python source is not proof of deployment.
3. Generate a **nonexportable** Ed25519 signing key on independently verified HSM hardware. An independent reviewer must authenticate the public SPKI via a separate channel and approve the **SHA-256 of canonical SPKI DER** in both committed OpenFront trust roots and a root-owned host policy. Zero fingerprints, guest enrollment and software-only test keys are blockers. No private key or token may enter a guest or artifact.
4. An operator-reviewed exact SHA, identical to the current `stage3/conductor3-class1-integration-20261121` tip, must be the candidate for a single authorized default-branch `workflow_dispatch`. Root/controller verification binds repository numeric ID `1459234894`, exact run ID/attempt, **numeric GitHub job ID**, **numeric JIT runner ID**, actual runner name, approved source checkout and fresh root-generated 256-bit challenge. A self-hosted label alone is not a physical identity.
5. Independently attest i915/virgl, GPU lease/ACL, WebGL1/2 rendered shader pixels from controller-owned observation and a real authorized browser per mode. Each of NATIONAL Solo desktop/mobile and legacy desktop/mobile gets a fresh, signed, 120-second or shorter `skybot-gpu-preflight-v1` receipt, cryptographically domain-separated from postflight. E5 owns gameplay outcomes; E6 owns physical identity.
6. After the **actual** job ends, root observes stopped/deleted VM and QEMU, JIT deregistration, GPU ACL and lease restoration, tmpfs/QCOW2/EFI removal, browser process removal, private credential/log destruction, and unchanged CPU capacity. Static cleanup booleans are not sufficient; record host observations.
7. A host-only sanitized artifact importer must bind immutable SHA-256 screenshot/summary bytes to job/runner/source. A nonexportable signer produces the `skybot-gpu-postflight-v1` receipt only after cleanup; an independent external verifier rejects omissions, signature replay, altered bytes or incomplete game stages.

## Operator read-only prerequisite checks — run on the *authorized real host*

```sh
sudo id -u
sudo systemctl status skybot-ci-controller.service skybot-ci-gpu-broker.socket --no-pager
sudo virsh -c qemu:///system list --all
sudo findmnt --mountpoint /var/lib/libvirt/images/ci-disposable/overlays -o TARGET,FSTYPE,OPTIONS
sudo stat -Lc '%U:%G %a %F' /dev/dri/renderD128
sudo getfacl -cp /dev/dri/renderD128
sudo test ! -e /run/skybot-ci/intel-virgl-acl.lease
```

These commands have **not been executed by this engineer**. An idle lease check does not prove a lease during a GPU job. Root operator must capture real output in private audit custody.

## Four-mode evidence contract

| Mode | Gameplay observer | Physical independent witness |
| --- | --- | --- |
| NATIONAL Solo desktop | E5: real server/gameplay, 1280x800, screenshot digests | E6: signed fresh preflight |
| NATIONAL Solo mobile | E5: real server/gameplay, 390x844, screenshot digests | E6: distinct signed preflight |
| Legacy desktop | E5: real server/gameplay, 1280x800, screenshot digests | E6: distinct signed preflight |
| Legacy mobile | E5: real server/gameplay, 390x844, screenshot digests | E6: distinct signed preflight |

Do not describe E5 private NATIONAL three-principal browser tests as a physical attestation. They are a separate release gate.

## Initial assessment and separation of verdicts

- OpenFront inherited E6 source CI passed targeted adversarial cases; whole-project tests failed on two other owners' tests at C3 founding SHA (Actions #44968552310).
- Private Skybot source CI #44956369092 was still queued at audit and **cannot** establish a deployed host witness.
- Neither a physical root session nor HSM key enrollment nor real signed preflight/postflight nor four-mode GPU execution is available in this engineering session.
- **Physical trust verdict: BLOCKED. Gameplay verdict: NOT CERTIFIED. Manager M9 score remains unchanged.**

No GPU run, root change, key creation or physical certificate is claimed.
