# C4 physical execution gate

**Source-only until independently demonstrated.** C4 founding SHA `7ba909572739bd0778c9cf34074008f1bf244124`; final approved staging SHA must be independently reviewed, not guessed or frozen to the founding commit.

The previous workflow dispatched default main while accepting a different checkout SHA. The host now requires the actual GitHub run head SHA, head repository, dispatch branch and workflow path, numeric run attempt/job/runner plus current writer permission to match independent root approval. Dispatch the exact reviewed staging **ref itself**, passing the same immutable SHA. Default main must retain the workflow registration; never run the older main implementation as a substitute. The root policy requires exact named ref and SHA; bounded stage-name syntax alone gives no permission. A future class must receive new independent root approval.

## Owner prerequisites

- Authorized physical operator verifies live controller registration, CPU capacity and GPU lease; no GitHub repository credentials imply root authorization.
- Independently reviewed controller and root witness installation, isolated GPU device, actual WebGL1/2 shader observation per mode, nonexportable HSM key with independently verified SPKI fingerprint enrolled in the public trust list. The current list is empty. Never generate a guest key or enroll a test key.
- Separate trusted host-owned proof scheduler and artifact custody; a guest assertion never replaces independent observations.
- Four serial genuine browser modes, fresh signed preflight per mode, independently verified sanitized artifacts and signed postflight after VM/QEMU removal, runner deregistration, restored ACL/lease, overlay/firmware and private credential/log removal, and preserved CPU capacity.

From an authorized GitHub workstation only, after all prerequisites and independent approval:

```sh
ref=stage3/conductor4-class1-integration-20261121
# SHA must be supplied from independent final review, not derived from a moving ref.
test -n "$APPROVED_SHA"
gh workflow run national-hardware-acceptance.yml --repo LeviCade/OpenFront-National --ref "$ref" -f candidate_sha="$APPROVED_SHA"
```

E4/E5: functional owner-operated hardware browser evidence may proceed separately, with exact reviewed source and four-mode results; never label it signed Skybot release evidence. A queued run, source test, software renderer, or root-unverified artifact does not certify hardware.

No host session, signing key enrollment, physical GPU dispatch, or teardown verified in this change.
