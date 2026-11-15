#!/usr/bin/env bash
# Stage 2: import exact OpenFront source snapshot, excluding protected assets.
set -Eeuo pipefail
TARGET_BRANCH="stage2/upstream-import-20261115"
UPSTREAM_SHA="445721718207b6e0f068258cd8ff2eccd13d198e"
UPSTREAM_REPO="https://github.com/openfrontio/OpenFrontIO.git"
if [[ "$GITHUB_REF_NAME" != "$TARGET_BRANCH" ]]; then
  echo "::error::Unexpected branch"; exit 1
fi
test -f docs/11-decisions.md
test -f AGENTS.md
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
STAGE1_SHA="$(git rev-parse HEAD)"
echo "NATIONAL stage 1 parent: $STAGE1_SHA"
echo "Pinned official upstream: $UPSTREAM_SHA"
git remote add openfront-official "$UPSTREAM_REPO"
# Shallow, blob-filtered source import avoids redistributing upstream history
# containing proprietary assets, while retaining precise public provenance.
git fetch --no-tags --depth=1 --filter=blob:none openfront-official "$UPSTREAM_SHA"
test "$(git rev-parse FETCH_HEAD)" = "$UPSTREAM_SHA"

git show "$UPSTREAM_SHA:README.md" > UPSTREAM-README.md
git show "$UPSTREAM_SHA:CONTRIBUTING.md" > UPSTREAM-CONTRIBUTING.md
git show "$UPSTREAM_SHA:proprietary/LICENSE" > /tmp/openfront-proprietary-license.txt

# Import all upstream tracked files into new NATIONAL-ancestry commit.
git restore --source="$UPSTREAM_SHA" --staged --worktree -- .

# Restore individual NATIONAL Stage 1 files, preserving upstream docs as well.
git ls-tree -r --name-only "$STAGE1_SHA" -- docs | while IFS= read -r file; do
  git restore --source="$STAGE1_SHA" --staged --worktree -- "$file"
done
git restore --source="$STAGE1_SHA" --staged --worktree -- \
  README.md CONTRIBUTING.md AGENTS.md \
  .github/scripts/stage2-import.sh \
  .github/scripts/stage2-verify.sh \
  .github/workflows/stage2-import.yml

# Archive upstream workflows as inert source; do not execute upstream deploys.
mkdir -p .github/upstream-workflows
for file in .github/workflows/*; do
  [[ -f "$file" ]] || continue
  [[ "$file" == ".github/workflows/stage2-import.yml" ]] && continue
  git mv "$file" ".github/upstream-workflows/$(basename "$file")"
done

# Protected images/fonts/music are NOT licensed under AGPL or CC BY-SA.
# Do not publish them or their historical Git objects into this fork.
if [[ -d proprietary ]]; then git rm -r -q -f proprietary; fi
mkdir -p docs/upstream-licenses
cp /tmp/openfront-proprietary-license.txt docs/upstream-licenses/PROPRIETARY-ASSET-LICENSE.txt

python3 - <<'PY'
from pathlib import Path
p=Path("README.md")
s=p.read_text()
s=s.replace(
"**Status:** Stage 1 vision baseline documented and committed. Stages 2 (migration) and 3 (coding) have not started. **No OpenFront game code has been migrated or modified in this repository yet.**",
"**Status:** Stage 1 complete. Stage 2 pinned upstream source **imported on migration branch; verification pending**. Stage 3 has not started. Protected upstream assets are intentionally omitted pending proper licensing or replacement."
)
s=s.replace(
"| **2 — Migration** | Import OpenFront upstream into this repository with history/provenance, license compliance, baseline tests, and an upstream update strategy | Not started |",
"| **2 — Migration** | Import upstream source with provenance, license compliance, baseline tests, and an upstream update strategy | **Snapshot imported; verification pending** |"
)
s=s.replace(
"**Stage 1 is documentation-only.** No claim of implemented features should be inferred from the documents in this repo.",
"**Stage 1 remains design-only.** Imported upstream source does not implement NATIONAL; see [Stage 2 evidence](docs/15-stage2-import-evidence.md)."
)
p.write_text(s)
PY

cat > docs/15-stage2-import-evidence.md <<EOF
# Stage 2 — source import evidence

**State: PINNED SOURCE SNAPSHOT IMPORTED; BASELINE BUILD/TEST VALIDATION PENDING.**
This is not an assertion that the fork is deployable or that NATIONAL is implemented.

- Repository: \`LeviCade/OpenFront-National\`
- Import branch: \`stage2/upstream-import-20261115\`
- Stage 1 parent commit: \`$STAGE1_SHA\`
- Official upstream: \`https://github.com/openfrontio/OpenFrontIO\`
- Exact pinned source commit: \`$UPSTREAM_SHA\`
- Provenance: \`https://github.com/openfrontio/OpenFrontIO/commit/$UPSTREAM_SHA\`
- Import strategy: upstream tracked snapshot copied into **this repo's existing Stage 1 ancestry**, without merging upstream history. Reason: the upstream history contains restricted proprietary assets that must not become accessible in this unrelated public repo's history.
- Stage 1 docs/README/AGENTS and upstream docs both preserved.
- Original upstream README and contributor guide: \`UPSTREAM-README.md\` and \`UPSTREAM-CONTRIBUTING.md\`.
- Original code and asset licensing files preserved: \`LICENSE\`, \`LICENSE-ASSETS\`, \`LICENSING.md\`, \`CREDITS.md\`. Check these exact versions before deployment.
- Upstream CI/deploy workflows archived to \`.github/upstream-workflows/\` and intentionally **disabled** for this fork; they can be adapted one by one later.
- \`/proprietary\` asset directory not redistributed: upstream explicitly reserves rights over its images, music and fonts; terms copied to \`docs/upstream-licenses/PROPRIETARY-ASSET-LICENSE.txt\`. The fork may require appropriately licensed replacement assets or documented permission before it can build or run.
- Submodule \`src/server/gatekeeper\` remains a pointer to a separate repo and was not expanded.
- No NATIONAL gameplay code has been changed.

## Reproducibility and future upstream sync

Pin upstream SHA before every future sync. Review license and proprietary changes, import a snapshot diff in a dedicated branch, retain NATIONAL docs and quarantine upstream automations, run deterministic and legacy-game regression tests, then submit a reviewed PR. **Never blindly merge upstream history or overwrite the Stage 1 design.**

## Validation still required

Use upstream-specified Node and npm versions and \`npm run inst\`. Run typecheck, tests, lint, format and build; record exact failures including missing proprietary assets if applicable. Only then change the Stage 2 status to verified. The real success condition is an integrated runnable game, not just presence of source files.

## Source-asset legal boundary

The AGPL-3.0 covers code, \`/resources\` assets are subject to CC BY-SA 4.0; \`/proprietary\` assets are **all rights reserved** and explicitly omitted. No permission to redistribute them is assumed.
EOF

git add -A
test -f docs/00-vision.md
test -f docs/11-decisions.md
test -f docs/API.md
test -f packages/engine/src/execution/WinCheckExecution.ts
test -f LICENSE
test -f LICENSE-ASSETS
test -f LICENSING.md
test -f .github/upstream-workflows/ci.yml
if git ls-files proprietary/ | grep -q .; then
  echo "::error::Restricted proprietary files accidentally staged"; exit 1
fi

echo "Selected change summary:"
git diff --cached --stat | tail -25
git commit -m "chore(stage2): import pinned OpenFront source with restricted assets excluded"
git push origin "HEAD:refs/heads/$TARGET_BRANCH"
echo "STAGE2_IMPORT_SHA=$(git rev-parse HEAD)" >> "$GITHUB_ENV"
echo "::notice::Source snapshot pushed to $TARGET_BRANCH; baseline still requires verification."
