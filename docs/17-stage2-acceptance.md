# 17 — Stage 2 development-baseline acceptance

**Decision:** Stage 2 migration accepted for development on November 15, 2026.
**No authorization for public production deployment is implied.**
NATIONAL mechanics remain unimplemented as of this acceptance.

## Pinned provenance and merge

- Official source: [openfrontio/OpenFrontIO](https://github.com/openfrontio/OpenFrontIO).
- Official upstream SHA: `445721718207b6e0f068258cd8ff2eccd13d198e`.
- NATIONAL migration PR: [#4](https://github.com/LeviCade/OpenFront-National/pull/4).
- Merged into main at `232be2f592343817108200d465578e2e3fe71ff5`.
- Tested source branch head: `03d826c2117d3d898b11e13dd0e68ab9e20fe8c0`.
- Original Stage 1 documents, independent repository ancestry, upstream
  licensing texts, credits and source attribution survived the import.

## Independent acceptance evidence

- [Stage 2 repair, source checks, production build and startup](https://github.com/LeviCade/OpenFront-National/actions/runs/43773995771):
  **SUCCESS**. Node 24.15.0, npm 12.1.0, lockfile install, typecheck,
  full existing unit tests, lint, full format check, production build,
  local client HTTP/assets, local server boot, source-rights gates.
- [Standalone migration PR baseline CI](https://github.com/LeviCade/OpenFront-National/actions/runs/43774123038):
  **SUCCESS** on the merged PR head. Full unit tests, types, lint,
  format and production build passed.
- [Headless deterministic full-game smoke](https://github.com/LeviCade/OpenFront-National/actions/runs/43774110387):
  **SUCCESS**. Two seeded game-engine simulations matched final
  state hash `781670843005502` at tick 400.

These prove a buildable, bootable, testable game **development baseline**,
not browser-complete public-release certification.

## Rights and runtime limitations

- Source code remains under upstream AGPL-3.0 with additional notices.
- Imported open `/resources` assets are CC BY-SA 4.0 per upstream notices.
- All-rights-reserved upstream `/proprietary` assets and restricted
  upstream Git ancestry were deliberately excluded.
- Original reproducible NATIONAL artwork supplies PWA icon, logo and
  initial Vite branding replacements. Upstream root CODEOWNERS was
  archived; upstream release/deploy automation remains inert.
- The upstream optional `src/server/gatekeeper` submodule was not copied;
  existing public-fork/no-op fallback allows the verified local boot.
- **Remaining pre-release requirements:** full browser-driven gameplay
  and residual asset/reference review
  ([issue #5](https://github.com/LeviCade/OpenFront-National/issues/5)),
  plus triage/remediation of 17 reported inherited dependency advisories
  including 4 critical
  ([issue #6](https://github.com/LeviCade/OpenFront-National/issues/6)).
  Do not label the fork production-safe without completing those gates.

## Stage 3 authorization

Stage 3 development may proceed from the merged main commit. The
conductor must establish shared authoritative contracts before independent
engineers edit overlapping state. Follow
[the Stage 3 conductor plan](18-stage3-conductor.md),
[the decision register](11-decisions.md) and
[the acceptance scenarios](10-scenarios.md).

The original Stage 2 import workflow is manual-only after this merge.
**Do not rerun the historical pinned source import** as an update mechanism;
perform future upstream synchronization by reviewed, scoped changes.
