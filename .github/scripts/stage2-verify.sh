#!/usr/bin/env bash
# Stage 2: verification of the imported source snapshot; never deploy.
set -uo pipefail
TARGET_BRANCH="stage2/upstream-import-20261115"
if [[ "$GITHUB_REF_NAME" != "$TARGET_BRANCH" ]]; then
  echo "::error::Unexpected branch"; exit 1
fi
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
mkdir -p stage2-logs
failed=0

run_check() {
  local label="$1"
  shift
  local slug
  slug="$(echo "$label" | tr '[:upper:] ' '[:lower:]-')"
  local logfile="stage2-logs/$slug.log"
  echo "::group::$label"
  echo "COMMAND: $*" > "$logfile"
  timeout 1200 "$@" >> "$logfile" 2>&1
  local code=$?
  if [[ "$code" == 0 ]]; then
    echo "PASS $label"
    printf '%s | PASS | Exit 0\n' "$label" >> stage2-logs/results.txt
  else
    echo "::error::$label FAILED (exit $code)"
    printf '%s | FAIL | Exit %s\n' "$label" "$code" >> stage2-logs/results.txt
    failed=$((failed+1))
    tail -35 "$logfile" || true
  fi
  echo "::endgroup::"
  return "$code"
}

{
  echo "Node: $(node --version)"
  echo "npm: $(npm --version)"
  echo "Upstream source: 445721718207b6e0f068258cd8ff2eccd13d198e"
  echo "Fork commit: $(git rev-parse HEAD)"
} > stage2-logs/environment.txt

installed=0
if run_check "Lockfile install" npm run inst; then installed=1; fi
if [[ "$installed" == 1 ]]; then
  run_check "Typecheck" npm run typecheck || true
  run_check "Unit tests" npm test || true
  run_check "Lint" npm run lint || true
  run_check "Format" npm run format:check || true
  run_check "Production build" npm run build-prod || true
else
  printf 'Typecheck | NOT RUN | Lockfile installation failed\nUnit tests | NOT RUN | Lockfile installation failed\nLint | NOT RUN | Lockfile installation failed\nFormat | NOT RUN | Lockfile installation failed\nProduction build | NOT RUN | Lockfile installation failed\n' >> stage2-logs/results.txt
fi

{
cat <<'EOF'
# Stage 2 — reproducible source verification

The imported source snapshot was verified in GitHub Actions. This file is generated
by the verification job. Check the workflow logs/artifacts for full stdout.

Repository: LeviCade/OpenFront-National
Branch: stage2/upstream-import-20261115
Pinned upstream OpenFront commit: 445721718207b6e0f068258cd8ff2eccd13d198e

Protected /proprietary images, fonts and audio were intentionally omitted due
to upstream redistribution restrictions. Some build failures may be related.
No NATIONAL game behavior is implemented by this import.

## Toolchain

EOF
cat stage2-logs/environment.txt
cat <<'EOF'

## Verification results

| Check | Result | Detail |
| --- | --- | --- |
EOF
while IFS='|' read -r label status detail; do
  printf '| %s | %s | %s |\n' "$label" "$status" "$detail"
done < stage2-logs/results.txt
cat <<'EOF'

## Readiness

EOF
if [[ "$failed" == 0 ]]; then
  echo "All executed baseline checks passed. Source/asset licensing, build/run rights and exact package completeness still require review before merging or deploying."
else
  echo "BASELINE VERIFICATION BLOCKED: $failed check(s) failed. Do not mark Stage 2 complete until repaired and verified. Source files alone do not mean a runnable migration."
fi
cat <<'EOF'

## Evidence

Full logs are in the GitHub Actions artifact for this run.
The restrictive /proprietary assets and unexpanded gatekeeper gitlink remain
explicit Stage 2 migration limitations. The Stage 1 product specs are intact.

Stage 3 remains NOT STARTED.
EOF
} > docs/16-stage2-verification.md

git add docs/16-stage2-verification.md
if ! git diff --cached --quiet; then
  git commit -m "docs(stage2): record baseline verification outcomes"
  git push origin "HEAD:refs/heads/$TARGET_BRANCH"
fi
if [[ "$failed" != 0 ]]; then
  echo "::error::Stage 2 verification failed. See docs/16-stage2-verification.md."
  exit 1
fi
echo "::notice::Baseline checks passed; inspect asset/completeness before merge."
