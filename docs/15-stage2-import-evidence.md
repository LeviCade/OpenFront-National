# Stage 2 — source import evidence

**State: PINNED SOURCE SNAPSHOT IMPORTED; BASELINE BUILD/TEST VALIDATION PENDING.**
This is not an assertion that the fork is deployable or that NATIONAL is implemented.

- Repository: `LeviCade/OpenFront-National`
- Import branch: `stage2/upstream-import-20261115`
- Stage 1 parent commit: `2061dbb5680e2c57eb89d2145cc34db47f342c05`
- Official upstream: `https://github.com/openfrontio/OpenFrontIO`
- Exact pinned source commit: `445721718207b6e0f068258cd8ff2eccd13d198e`
- Provenance: `https://github.com/openfrontio/OpenFrontIO/commit/445721718207b6e0f068258cd8ff2eccd13d198e`
- Import strategy: upstream tracked snapshot copied into **this repo's existing Stage 1 ancestry**, without merging upstream history. Reason: the upstream history contains restricted proprietary assets that must not become accessible in this unrelated public repo's history.
- Stage 1 docs/README/AGENTS and upstream docs both preserved.
- Original upstream README and contributor guide: `UPSTREAM-README.md` and `UPSTREAM-CONTRIBUTING.md`.
- Original code and asset licensing files preserved: `LICENSE`, `LICENSE-ASSETS`, `LICENSING.md`, `CREDITS.md`. Check these exact versions before deployment.
- Upstream CI/deploy workflows archived to `.github/upstream-workflows/` and intentionally **disabled** for this fork; they can be adapted one by one later.
- `/proprietary` asset directory not redistributed: upstream explicitly reserves rights over its images, music and fonts; terms copied to `docs/upstream-licenses/PROPRIETARY-ASSET-LICENSE.txt`. The fork may require appropriately licensed replacement assets or documented permission before it can build or run.
- Submodule `src/server/gatekeeper` remains a pointer to a separate repo and was not expanded.
- No NATIONAL gameplay code has been changed.

## Reproducibility and future upstream sync

Pin upstream SHA before every future sync. Review license and proprietary changes, import a snapshot diff in a dedicated branch, retain NATIONAL docs and quarantine upstream automations, run deterministic and legacy-game regression tests, then submit a reviewed PR. **Never blindly merge upstream history or overwrite the Stage 1 design.**

## Validation still required

Use upstream-specified Node and npm versions and `npm run inst`. Run typecheck, tests, lint, format and build; record exact failures including missing proprietary assets if applicable. Only then change the Stage 2 status to verified. The real success condition is an integrated runnable game, not just presence of source files.

## Source-asset legal boundary

The AGPL-3.0 covers code, `/resources` assets are subject to CC BY-SA 4.0; `/proprietary` assets are **all rights reserved** and explicitly omitted. No permission to redistribute them is assumed.
