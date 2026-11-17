# NATIONAL R8 — Font, audio and browser asset provenance

**Release gate #5: OPEN.** Baseline integration `5e956e13f9e3b054c15cfd75110284c5a48fdd5c`. E5 audit does not grant permission to any private upstream CDN/resource.

## Verified repository license boundary

- `LICENSE-ASSETS` explicitly states **`/resources` is CC BY-SA 4.0**, including open artwork, audio and fonts, with attribution required to **OpenFront / OpenFront Inc.** `resources/LICENSE` repeats the CC BY-SA 4.0 grant.
- The separate `/proprietary` directory is **all rights reserved** and was excluded from migration; non-repository OpenFront CDN, API, music, premium assets or hosted skins have **no open license** merely because a client requests them.
- `LICENSING.md` and original notices must be preserved. Modifications must not imply OpenFront endorsement or that the original artist made NATIONAL edits.
- The automated 12-file shell audit checks known present licenses, original NATIONAL logo/icon files, and absence of the restricted directory; it does **not** certify runtime availability or third-party font sound origin.

## Exact resource candidates requiring origin verification

From exact merged-SHA [independent release QA run #44020170176](https://github.com/LeviCade/OpenFront-National/actions/runs/44020170176), archived asset artifact `14301220256`:

- **2 font files:** `resources/fonts/overpass.woff`, `resources/fonts/overpass-bold.woff`.
- **4 ambience MP3s:** city, factory, missile-silo, sam-silo.
- **34 effects MP3s:** alliance and warfare UI cues, explosions, construction, impact, train/ship, victory/defeat and other game audio under `resources/sounds/effects`.
- **40 binary media candidates in total.** All are in the open-resource license tree, **not** `/proprietary`. The directory-level CC BY-SA declaration is documented, but an independent original author/source record for each of these 40 binary files remains unverified. Overpass font authorship/SIL OFL or any upstream exception must be independently confirmed before claiming a specific separate font license.

`scripts/national-qa/asset-audit.mjs` now exports **each candidate's exact path, SHA-256, byte size, media classification, governing resource-directory license and `independentOriginReview: PENDING`** to `national-qa-artifacts/assets.json`. A regenerated file identity can be compared with the pinned upstream snapshot; fingerprints are not licenses.

## Runtime checks and release decision

The updated real-Chromium `browser-gameplay.mjs` records asset network requests with **origin and pathname only**, scrubbing query strings and fragments to avoid revealing URL-embedded tokens. It retains original failure/status evidence and fails if the browser requests `/proprietary/` or a recognized OpenFront-provided CDN subtree. This does not silently fetch, copy or redistribute those assets.

**Still required before release:** all four genuinely hardware-backed desktop/mobile NATIONAL/FFA browser scenarios, game-session network resource inventory (not just homepage), missing-path review, audio and font rendering/function checks, original-author provenance where distinct from the directory license, lawful replacement of actually restricted assets when found, preservation of attribution, and explicit Conductor clearance on #5. No fabricated origin or asset hash will be supplied.

## Attribution to retain

> OpenFront open-source resources © OpenFront Inc. and contributors, used under Creative Commons Attribution-ShareAlike 4.0. NATIONAL is an independent modified game and is not endorsed by OpenFront Inc.

This statement is documentation for required notice; verify placement in the final shipped UI and distribution.
