#!/usr/bin/env bash
# One-time Stage 2 migration repair: no NATIONAL gameplay changes and no deployment.
set -Eeuo pipefail
[[ "$GITHUB_REPOSITORY" == "LeviCade/OpenFront-National" ]] || { echo "Wrong repository"; exit 1; }
[[ "$GITHUB_REF_NAME" == "stage2/upstream-import-20261115" ]] || { echo "Wrong branch"; exit 1; }
test -f docs/15-stage2-import-evidence.md
test -f packages/engine/src/game/GameImpl.ts
test -f LICENSE-ASSETS
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

echo "::group::Reconcile authoritative main history"
git fetch --no-tags origin main
git merge --no-edit -X theirs origin/main
test -f PROJECT_HANDOFF.md
test -f .github/workflows/national-baseline-ci.yml
echo "::endgroup::"

echo "::group::Replace restricted brand references with original NATIONAL bootstrap art"
python3 .github/scripts/generate-national-assets.py
python3 - <<'PY'
from pathlib import Path
import json
p = Path("vite.config.ts")
s = p.read_text()
replacements = {
    '"images/Favicon.svg"': '"images/NationalMark.svg"',
    '"images/KeyArt.jpg"': '"images/GameplayScreenshot.png"',
    '"images/OpenFront.png"': '"images/NationalLogo.svg"',
    '"images/OF.png"': '"images/NationalMark.svg"',
}
for old, new in replacements.items():
    count = s.count(old)
    if count == 1:
        s = s.replace(old, new)
    elif count == 0 and s.count(new) >= 1:
        print(f"Already migrated: {new}")
    else:
        raise SystemExit(f"Unexpected vite asset reference state: {old!r} -> {new!r}")
p.write_text(s)

p = Path("resources/manifest.json")
manifest = json.loads(p.read_text())
manifest["name"] = "OpenFront: NATIONAL — The Age of Sovereignty"
manifest["short_name"] = "NATIONAL"
for icon in manifest["icons"]:
    rel = "resources/" + icon["src"].lstrip("/")
    if not Path(rel).is_file():
        raise SystemExit(f"Manifest icon missing: {rel}")
p.write_text(json.dumps(manifest, indent=2) + "\n")

p = Path("index.html")
s = p.read_text()
s = s.replace('<title data-i18n="main.title">OpenFront (ALPHA)</title>',
              '<title data-i18n="main.title">OpenFront: NATIONAL</title>')
s = s.replace('content="OpenFront - Battle Royale"', 'content="OpenFront: NATIONAL — The Age of Sovereignty"')
# Do not suggest this independent build is the official openfront.io site.
s = s.replace('href="https://openfront.io/"', 'href="https://github.com/LeviCade/OpenFront-National"')
s = s.replace('content="https://openfront.io/"', 'content="https://github.com/LeviCade/OpenFront-National"')
s = s.replace('"url": "https://openfront.io/"', '"url": "https://github.com/LeviCade/OpenFront-National"')
p.write_text(s)

# Never assign independent-repo reviews to an upstream maintainer organization.
p = Path("CODEOWNERS")
if p.is_file():
    Path("docs/upstream-licenses/UPSTREAM-CODEOWNERS.txt").write_bytes(p.read_bytes())
    p.unlink()
# Check newly authored and publicly referenced assets are present.
required = [
    "images/NationalMark.svg", "images/NationalLogo.svg",
    "images/GameplayScreenshot.png", "images/background.webp",
    "icons/icon512_maskable.png", "icons/icon512_rounded.png",
]
for rel in required:
    if not (Path("resources") / rel).is_file():
        raise SystemExit(f"Missing permitted replacement: {rel}")
print("Original NATIONAL assets generated; upstream CODEOWNERS archived.")
PY
echo "::endgroup::"

echo "::group::Format existing NATIONAL docs and bootstrap files with upstream formatter"
npm run inst
npm exec -- oxfmt --write \
  README.md \
  docs/00-vision.md docs/01-victory-and-difficulty.md \
  docs/02-national-ai.md docs/03-coalitions.md docs/04-empires.md \
  docs/05-war-and-peace.md docs/06-sanctions-and-blockades.md \
  docs/07-intelligence.md docs/08-experience.md docs/11-decisions.md \
  docs/13-migration-plan.md docs/14-roadmap.md docs/README.md \
  docs/16-stage2-verification.md \
  resources/manifest.json vite.config.ts index.html
echo "::endgroup::"

echo "::group::Verify content and rights before committing"
test "$(git ls-files proprietary/ | wc -l)" -eq 0
if grep -R -l '@openfrontio/maintainer' .github/CODEOWNERS CODEOWNERS 2>/dev/null; then
  echo "::error::Upstream active CODEOWNERS remain"; exit 1
fi
test -f docs/11-decisions.md
test -f docs/10-scenarios.md
test -f PROJECT_HANDOFF.md
test -f UPSTREAM-README.md
git add -A
git diff --cached --stat | tail -45
if ! git diff --cached --quiet; then
  git commit -m "fix(stage2): restore main CI and permitted original branding; format design files"
  git push origin HEAD:refs/heads/stage2/upstream-import-20261115
fi
echo "::endgroup::"
