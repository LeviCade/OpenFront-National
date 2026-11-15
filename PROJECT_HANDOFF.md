# 👑 OpenFront: NATIONAL — Permanent Project Handoff

**Repository:** https://github.com/LeviCade/OpenFront-National

**Official upstream:** https://github.com/openfrontio/OpenFrontIO

**Checkpoint recorded November 15, 2026.** This is a durable status/handoff guide; verify current GitHub branch heads, Actions conclusion, and issues before making any claims about progress.

## Start here in every future chat

Read this handoff, [AGENTS.md](AGENTS.md), [the design index](docs/README.md), [design decision register](docs/11-decisions.md), [acceptance scenarios](docs/10-scenarios.md), and [roadmap](docs/14-roadmap.md) before doing work. The source of truth is in GitHub, not previous chat context.

**Stage 1 — VISION: COMPLETE.** 20 original docs/contributor/agent files committed. [Issue #1](https://github.com/LeviCade/OpenFront-National/issues/1) closed.

**Stage 2 — MIGRATION: ACTIVE ON A SEPARATE BRANCH, NOT YET ACCEPTED AT THIS CHECKPOINT.** [Issue #2](https://github.com/LeviCade/OpenFront-National/issues/2). Branch: [stage2/upstream-import-20261115](https://github.com/LeviCade/OpenFront-National/tree/stage2/upstream-import-20261115). [GitHub Actions import and verification run #43767389661](https://github.com/LeviCade/OpenFront-National/actions/runs/43767389661) launched. **Do not assume the run passed simply because it started.**

**Stage 2 review PR:** [Draft migration PR #4](https://github.com/LeviCade/OpenFront-National/pull/4). Additional focused asset-readiness tracking: [issue #5](https://github.com/LeviCade/OpenFront-National/issues/5). Fork-native [baseline CI](.github/workflows/national-baseline-ci.yml) is available for documentation checks now and full tests when a source tree is present.

**Stage 3 — CODING: NOT STARTED.** [Issue #3](https://github.com/LeviCade/OpenFront-National/issues/3) is blocked by Stage 2 verification.

## Stage 2 exact reproducible facts

- Official upstream pinned commit: 445721718207b6e0f068258cd8ff2eccd13d198e.
- [Exact upstream revision](https://github.com/openfrontio/OpenFrontIO/commit/445721718207b6e0f068258cd8ff2eccd13d198e).
- Upstream has about 4,509 ordinary tracked blobs totaling roughly 1.19 GB, plus a gitlink at src/server/gatekeeper (separate submodule).
- The migration branch contains import script .github/scripts/stage2-import.sh, verification script .github/scripts/stage2-verify.sh, and workflow .github/workflows/stage2-import.yml.
- A successful import writes docs/15-stage2-import-evidence.md; subsequent verification writes docs/16-stage2-verification.md and uploads full logs as a GitHub Actions artifact.
- The import copies a pinned upstream **source snapshot into NATIONAL's Stage 1 ancestry**, rather than grafting the entire upstream Git history (which contains proprietary assets). It records exact upstream provenance.
- Original upstream README/contributor files are preserved under UPSTREAM-README.md and UPSTREAM-CONTRIBUTING.md. Stage 1 design, README, AGENTS and CONTRIBUTING are preserved. Unrelated upstream docs survive.
- Upstream CI/deploy/cron workflows are preserved as inert references under .github/upstream-workflows, not activated in this new repo.
- Licensing: code AGPL-3.0, open /resources assets CC BY-SA 4.0, and /proprietary assets **all rights reserved** with restrictions against separate copying or redistribution. The independent fork import **intentionally excludes restricted /proprietary assets** while retaining the original licensing language. Those omissions may prevent successful build/run pending license permission or original permitted replacements. Do not republish those images, music or fonts without appropriate rights.
- src/server/gatekeeper is a git submodule pointer, not included executable submodule content. Assess its access and necessity when verifying the baseline.
- There is no NATIONAL game logic in the imported upstream snapshot. Source import is not feature coding.

## First actions in a new chat

1. Fetch live repository heads for main and stage2/upstream-import-20261115.
2. Inspect [run #43767389661](https://github.com/LeviCade/OpenFront-National/actions/runs/43767389661) and its job logs for import/verification status.
3. If import failed, fix the exact error on the dedicated branch. The workflow triggers on changes to its workflow file; a script-only update does not automatically retrigger. Use a permitted Actions rerun or a small audited workflow edit. Never force-push or delete the Stage 1 docs.
4. If import succeeded, confirm code/config/resources, license and attribution files are present, Stage 1 docs are intact, upstream workflows are inert, and NO restricted proprietary assets were committed.
5. If verification failed, inspect docs/16-stage2-verification.md plus the Actions log artifact. Resolve actual install, typecheck, tests, lint, format, build and asset/submodule issues. Do not call source presence a verified runnable game.
6. Once baseline builds and tests pass, rights are respected, and no unexpected deploy automation is active, open/review Stage 2 PR to main and merge safely, then update status documentation and close issue #2.
7. Begin Stage 3 ONLY after verified Stage 2 acceptance. Follow existing roadmap and scenario IDs.

## The full vision — DO NOT REDESIGN OR FORGET

**NATIONAL is a new Solo FFA strategic experience above Impossible.** Every nation fights to WIN. No nation arbitrarily attacks the human, free cheats, omniscient AI or mandatory anti-runaway dogpile. AI uses independent long-term objectives, observed diplomacy/memory, geography, threat credibility, and existing information permissions.

**Victory:** Exactly one independent sovereign nation or one empire must be the last surviving political power. Independent Sovereign Victor and imperial sovereign Imperial Victor are equally prestigious top wins. Surviving constituent Empire Victors legitimately win but earn lesser prestige. Independent nations should resist becoming empire members except for genuine worsening existential danger with few alternatives; relative size alone never forces submission. After accession, members work just as hard for imperial victory.

**Constitutional coalitions:** Non-Aggression Pacts, Mutual Defense Alliances, Empires. Independent nations can hold multiple ordinary memberships. Ordinary coalition constitutions control admissions/discipline; amendments require unanimous approval. An independent nation can Betray and exit at any time with mandatory expulsion, including from pacts prohibiting discretionary expulsion. No prohibited internal attacks without betrayal. Automatic MDA defense levies are weighted, real troop deductions on actual incoming invasion, pre-tile loss, and never double-spend or refresh infinitely via micro-attacks.

**Empires:** One supreme Imperial Nation per empire. No imperial member, even emperor, may join an outside coalition. Members cannot unilaterally leave. Emperor can invite/access members, dissolve, transfer imperial crown, unilaterally change government policies for treasury, construction, trading, external relations and military modes (centralized, hybrid, decentralized). Troop pools and treasury conserve resources. Exceptional Ungovernable collapse when emperor is uniquely last in all eight metrics (land, max population, active population, cities, factories, ports, silos, warships) and fails 10-second leadership transfer warning; elimination without transfer also collapses empire.

**Layered war and peace:** Default is peace; all offensive action requires a declared war. Every empire can have individual national wars for members and separate empire-wide wars, which automatically bind everyone and can be ended only by emperor. Ending an empire-wide war does NOT erase an earlier national war. Emperor may delegate national war/peace authority but can always override. Peace needs proposal and acceptance. Peacetime embargoes allowed. Piracy requires actual applicable war. Already-in-flight missiles still detonate after peace; already-sailing invasion takes only first landing tile and returns; land invasions halt when effective peace begins.

**Economic coercion and blockades:** Formal secondary sanctions, embargos, coercive imperial membership ultimata and member-proxy wars. Recipient may refuse; a threat requires actual credible follow-through. Maritime blockade is physical wartime interception: enemy trade ships may be pirated, neutral ships are turned toward their nearest home port and earn NO trade gold. Emperor can centrally sanction all outside trade, or allow selected member response depending on imperial policy.

**Fog of war:** Public nation name, land percentage, wars and coalition membership; outside treaty terms concealed. Military, treasury, structures, ship positions and transport landing destination hidden without legitimate observation. Initial sample sight: 100 tiles into neighbors at land borders, ships within 200 of owned coast/warship. Intelligence tiers using existing gold, empire shares all legitimately observed intelligence. AI must use the same observation limits as humans.

**DEFERRED ECONOMICS:** Currencies, goods, industry/resource model, sovereign credit, collateral/loan notes, public credit ratings, new build pricing and removal of cost discounts are **NOT PART OF NATIONAL initial version**. Existing gold/trade system remains for political features.

## Full index

- [Vision](docs/00-vision.md)
- [Victory/difficulty](docs/01-victory-and-difficulty.md)
- [National AI](docs/02-national-ai.md)
- [Coalitions](docs/03-coalitions.md)
- [Empires](docs/04-empires.md)
- [War and peace](docs/05-war-and-peace.md)
- [Sanctions and blockades](docs/06-sanctions-and-blockades.md)
- [Intelligence](docs/07-intelligence.md)
- [Experience/UI](docs/08-experience.md)
- [Engineering invariants](docs/09-engineering-constraints.md)
- [Acceptance scenario matrix](docs/10-scenarios.md)
- [Decisions and OPEN items](docs/11-decisions.md)
- [Deferred economics](docs/12-deferred-economics.md)
- [Migration plan](docs/13-migration-plan.md)
- [Stage 3 roadmap](docs/14-roadmap.md)

## Reuse prompt for next ChatGPT conductor

> Inspect LeviCade/OpenFront-National on GitHub. Read PROJECT_HANDOFF.md, AGENTS.md, docs/README.md, docs/11-decisions.md, docs/10-scenarios.md, and docs/14-roadmap.md. Check both main and stage2/upstream-import-20261115 and Actions run #43767389661. Determine exactly what migrated, whether baseline tests/build passed, what asset/licensing blockers remain, and whether Stage 2 is ready for merge. Preserve all Stage 1 design, current code and test evidence. No Stage 3 coding before migration acceptance. Summarize verified progress with SHAs and next tasks.

## Conductor engineering rules

- No claims of future work being performed asynchronously unless a real Actions/automation job is explicitly running and evidence is linked.
- Every implementation PR cites design decision IDs, scenario IDs, and exact CI.
- No silent deviations from current national-interest/self-preservation principles; consult decision register for OPEN issues before coding.
- No double troops, phantom gold, hidden-information leakage, unauthorized diplomacy, or overwritten imperial/national war layers.
- No regression of old game modes. Full integrated end-to-end tests, replay determinism and benchmark required.

**THE GOAL IS TO BUILD A FULLY FUNCTIONING GAME, NOT JUST TO ACCUMULATE GREEN ISOLATED PRS.**
