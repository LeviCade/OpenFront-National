# 13 — Stage 2: Upstream migration plan

**STATUS: ACTIVE ON A DEDICATED STAGE 2 BRANCH (as of November 15, 2026); not yet accepted on main.** The import workflow and its verification are tracked in [PROJECT_HANDOFF.md](../PROJECT_HANDOFF.md) and [Stage 2 issue #2](https://github.com/LeviCade/OpenFront-National/issues/2). Do not claim success until exact build/test and licensing gates pass.

## Source of truth

- Official upstream: https://github.com/openfrontio/OpenFrontIO
- This independent project: https://github.com/LeviCade/OpenFront-National
- Official game: https://openfront.io/

At migration time, pin a **specific current upstream commit SHA** as the baseline. Record date, SHA, original upstream URLs, any modifications and reason. Do not pretend this is an upstream-endorsed official version.

## Verified upstream licensing notes (pre-migration)

The official upstream README states:

- Code is **GNU Affero General Public License v3.0**.
- Assets have a separately documented **CC BY-SA 4.0** licensing framework.
- Upstream uses a **LICENSE**, **LICENSE-ASSETS**, and **LICENSING.md**, with visible copyright notices in footer/loading screen and possibly other relevant references.

Stage 2 must inspect the **then-current exact versions** and comply with all applicable terms. Preserve upstream copyright, licensing files, attribution, asset credits, notice text and modifications notices. Do not remove visible notices. For network delivery, understand AGPL source availability requirements and verify compliance before publishing an instance. If there are third-party/proprietary dependencies or artwork subject to restrictions, inventory them independently before distribution.

A source-code fork can contain upstream materials subject to different licenses. "Public GitHub repository" does not mean every asset can be freely reused outside its specified permissions. Also avoid implying upstream branding or official endorsement.

## Migration workflow

1. **Record documentation baseline:** freeze Stage 1 docs as tagged/reviewed milestone. Don't overwrite the product vision with upstream's README.
2. **Review upstream repo and dependencies:** latest default branch HEAD, node/npm versions, lockfile, tooling, build/test scripts, server deployment expectations, assets/licenses, readme and upstream notice locations.
3. **Choose history-preserving migration approach:** create a dedicated migration branch and import the upstream repository with documented provenance, the current Stage 2 attempt uses a pinned snapshot commit rather than importing upstream ancestry, because its history also contains assets subject to restricted proprietary terms. It preserves authorship/provenance through the exact original upstream SHA and license notices; never redistribute upstream historical Git objects blindly. Since this repository already contains unrelated design-doc commits, inspect Git history merge options and handle root README/CONTRIBUTING/AGENTS collisions explicitly. Avoid broad force-pushes that erase Stage 1 history.
4. **Preserve NATIONAL docs:** make sure project-level README and docs remain discoverable and link-valid after the import. Preserve upstream readme and migration instructions in suitable clearly labeled locations.
5. **Check legal/asset inventory:** include required license and copyright notices and a provenance inventory. Check asset license terms before shipping assets.
6. **Baseline run:** follow upstream's then-current exact install instructions, typecheck, lint, build, unit/integration tests, game smoke, server/client startup. Don't weaken or skip gates simply to call migration done.
7. **Record reproducibility:** pin verified upstream SHA, toolchain versions, checksums and migration diff; test baseline at that SHA.
8. **Upstream synchronization plan:** define when/how future upstream merges occur, with safe conflict resolution for new game systems.
9. **Only then authorize Stage 3.** Keep Stage 2 commits focused on integration and compatibility; no speculative AI or diplomacy implementation while establishing baseline.

## Current known upstream setup

At time of writing (2026-11-15), official README specifies Node **24.15.0+ within Node 24**, npm **12.1.0+ within npm 12**, and **npm run inst** using a lockfile-driven, scripts-disabled install workflow. **Revalidate on Stage 2** rather than treating these as timeless.

## Migration acceptance

- Real code checkout runs, correctly credits upstream, and includes all required legal/asset notices.
- The original Stage 1 NATIONAL documents survive with no silent rewriting.
- Licensing and asset obligations are documented; no prohibited asset copies.
- Existing OpenFront behavior and tests pass unchanged.
- Migration is identifiable by tagged commit and exact upstream SHA.
- No NATIONAL features are falsely marked implemented.
