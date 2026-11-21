#!/usr/bin/env bash
# E6: one admitted GPU guest, one install, four real E5 processes, four reports.
# Raw game logs remain inside the disposable guest and are never uploaded.
set -uo pipefail
kind="${1:-}"
case "$kind" in
  diagnostic) test "${NATIONAL_REQUIRE_HARDWARE_GPU:-}" = 0 || exit 2 ;;
  release) test "${NATIONAL_REQUIRE_HARDWARE_GPU:-}" = 1 || exit 2 ;;
  *) echo 'Invalid E6 run lane' >&2; exit 2 ;;
esac
: "${NATIONAL_GPU_CANDIDATE_SHA:?immutable reviewed SHA required}"
[[ "$NATIONAL_GPU_CANDIDATE_SHA" =~ ^[0-9a-f]{40}$ ]] || exit 2
mkdir -p national-qa-artifacts/gpu
: > national-qa-artifacts/gpu/scenarios.jsonl
private_log_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/national-r10-gpu.XXXXXXXX")" || exit 2
trap 'rm -rf -- "$private_log_dir"' EXIT
failed=0
for mode in national-desktop national-mobile legacy-desktop legacy-mobile; do
  args=()
  case "$mode" in
    national-mobile) args=(--mobile) ;;
    legacy-desktop) args=(--legacy) ;;
    legacy-mobile) args=(--legacy --mobile) ;;
  esac
  if [[ "$kind" == release ]]; then
    # Read-only, root-controller-delivered PUBLIC material in guest tmpfs.
    # A new independently signed preflight is REQUIRED for every mode.
    if ! node scripts/national-gpu-ci/wait-host-proof.mjs "$mode"; then
      echo "E6_RELEASE_BLOCKED_NO_FRESH_HOST_PROOF=$mode"
      exit 1
    fi
    proof_root=/run/skybot-ci-national-gpu-proof
    export NATIONAL_GPU_ATTESTATION_FILE="$proof_root/controller-preflight-$mode.json"
    export NATIONAL_GPU_PUBLIC_KEY_FILE="$proof_root/host-public-key.pem"
    NATIONAL_GPU_ATTESTATION_CHALLENGE="$(cat -- "$proof_root/challenge")"
    export NATIONAL_GPU_ATTESTATION_CHALLENGE
    [[ "$NATIONAL_GPU_ATTESTATION_CHALLENGE" =~ ^[0-9a-f]{64}$ ]] || exit 1
  fi
  echo "E6 starting $kind $mode"
  GITHUB_SHA="$NATIONAL_GPU_CANDIDATE_SHA" timeout --kill-after=10s 205s \
    node scripts/national-qa/browser-gameplay.mjs "${args[@]}" \
    > "$private_log_dir/$mode.log" 2>&1
  code=$?
  result=FAIL
  if (( code == 0 )); then result=PASS; fi
  printf '{"scenario":"%s","result":"%s","exitCode":%d}\n' "$mode" "$result" "$code" \
    >> national-qa-artifacts/gpu/scenarios.jsonl
  echo "E6 process $mode exit=$code (raw log retained inside guest only)"
  if (( code != 0 )); then failed=1; fi
done
if ! node scripts/national-gpu-ci/sanitize-browser-evidence.mjs --kind "$kind"; then
  failed=1
fi
if (( failed )); then
  echo "E6_${kind^^}_OVERALL=FAIL"
  exit 1
fi
echo "E6_${kind^^}_OVERALL=PASS (release certification separately gated)"
