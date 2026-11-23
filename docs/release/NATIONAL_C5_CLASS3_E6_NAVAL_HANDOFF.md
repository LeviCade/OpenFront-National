# Fifth Conductor, Class Three — E6 COMMAND OF THE SEAS

Issue: [#177](https://github.com/LeviCade/OpenFront-National/issues/177)  
Branch: `feature/c5-class3-e6-lawful-national-naval-ai-20261122`  
Founding commit: `1c700c46ff981a5857ead6f4ad63636448b7478d`  
Unmerged draft: [PR #180](https://github.com/LeviCade/OpenFront-National/pull/180) → `stage3/conductor5-class3-integration-20261122`.  
**No merge, release certification, milestone points or percentage claim by this engineer.**

## Attribution

Existing NATIONAL NAV-01/02/03/04/05 law, piracy payout, blockade neutral return, war ledger, economic voyage payouts, water navigation and random legacy FFA warship AI were present at the founding SHA. These are **inherited**, never claimed as E6 work.

New E6 behavior is a deliberately triggered **observed commercial target → live sovereign WAR recheck → financed, genuinely built/moved ship → existing maritime execution with real trade effects**.

## Production files and ownership

- `packages/engine/src/national/ai/NationalNavalStrategy.ts` — new pure planner. Reads only current principal-filtered `NationalObservation.visibleAssets`, public active WAR sides, and own-port coordinates. Selects closest visible enemy `trade-ship` contact. No hidden foreign port registry, secret unit iteration, user-supplied sightings or guessed ship target.
- `packages/engine/src/execution/nation/NationWarshipBehavior.ts` — E6-owned NATIONAL-only dispatch. Requires active current authority `authorizeOffensiveAction`, non-friendly target, a ship-size-capable port attached to the target's real water component, live own gold and default construction permissions. Dispatches **original** `ConstructionExecution` or `MoveWarshipExecution` and retains one principal-local mission cooldown through the existing optional behavior snapshot. Keeps FFA code paths intact.
- `packages/engine/src/execution/NationExecution.ts` — one E6 line-site directly after `const observation = verified.observation;`: initialize the behavior if necessary, dispatch using that verified current observation. **Engineer Five owns reconnaissance in this shared file. Preserve all E5 hook and memory fields; do not overwrite their section or restore from E6 copy wholesale.**
- `tests/national/C5Class3NavalAI.test.ts` — real GameRunner and maritime tests, correlated revenue/tick/physical ship witness, protected neutral/peace/gold/visibility/replay, disconnected basins and duplicate-spend checks.
- `tests/national/C5Class3NavalPerf.test.ts` — 100 independent nations, 2,500 ships, 25,000 sight grants, 200 observation/planning rounds; includes hidden-port non-interference.
- `.github/workflows/national-c5-class3-e6-naval.yml` — immutable SHA checkout; TypeScript, full build, lint, exact formatter, and naval/political/FFA tests.

## Evidence from verified previous CI source heads

At `eb5ce845e2e726a763f2e11912f4c0724644938f`, [GitHub Actions run #45102822415](https://github.com/LeviCade/OpenFront-National/actions/runs/45102822415) verified source SHA, TypeScript **PASS**, 75/75 tests **PASS**, lint **PASS**, production build **PASS**; **formatter failed** (subsequent source patches must be independently rechecked).

The identical-seed, real-four-nation GameRunner naval comparison logged:

| Effect                   | Observed active AI WAR | Identical-seed, naval-AI-disabled CONTROL |
| ------------------------ | ---------------------: | ----------------------------------------: |
| Enemy B trade payout     |           **915 gold** |                            **1,830 gold** |
| A earned lawful piracy   |           **311 gold** |                                **0 gold** |
| A new warship            |            **ship #8** |                                  **none** |
| Actual construction cost |       **250,000 gold** |                                     **0** |

Physical warship #8 moved from tile **186** to **108** after real navigation; another real, independently dispatched ship #6 traversed **20 distinct water tiles** and moved within 2 Manhattan tiles of observed target tile **200**. WAR authority was true during the dispatch. The 915-gold difference is **real paid enemy trade income** suppressed in the live voyage, not a score guessed from coordinates. Original maritime payout/neutral handling was preexisting.

At `7a69802ea0ca1537766b88c31a300f0ce1bdc9b7`, [run #45102861806](https://github.com/LeviCade/OpenFront-National/actions/runs/45102861806) recorded **135.83ms** for 200 projections+plans over 100 independent sovereigns, 2,500 vessels and 25,000 sight grants. **75/75 scoped tests PASS**, typecheck/lint/build PASS, formatter failed for expanded tests. This is one measured CI run, **not** a worst-case guarantee, all-game-profile or live global-sized map result.

The current final head is intentionally not asserted here until the final exact-head CI run completes.

## Constitutional guard and integration

Selection must be based solely on current authorized `collectLiveNationalObservation`; current WAR is rechecked against the real Game authority before issuing an order. Existing `WarshipExecution` handles construction, travel, combat, neutral return and payouts. No new independent revenue simulation, teleport, spying, fake blockade or peacetime piracy. Cooldowns cannot be reset by temporary lost sight.

E5 merge instruction: preserve E5 reconnaissance and political memory as-is; retain this E6 call site after the observed principal is established. No E2 revenue split or E3 trade override code is replaced. The existing Game/Player payout route is the only accounting source.

Exact standard checks:

```bash
npm run typecheck
npx --no-install vitest run --project node tests/national/C5Class3NavalAI.test.ts tests/national/C5Class3NavalPerf.test.ts tests/national/C4Class2EconomicMaritime.test.ts tests/national/NationalAIRealWar.test.ts tests/NationWarshipNukeReserve.test.ts tests/Warship.test.ts tests/national/C5CoastalVisibility.test.ts
npm run lint
npx --no-install oxfmt --check packages/engine/src/national/ai/NationalNavalStrategy.ts packages/engine/src/execution/nation/NationWarshipBehavior.ts packages/engine/src/execution/NationExecution.ts tests/national/C5Class3NavalAI.test.ts tests/national/C5Class3NavalPerf.test.ts
npm run build-prod
```

## Remaining governance

A visible commercial vessel is necessary evidence for this planner. A hidden port or guessed sea lane **cannot** trigger a naval purchase. The planner does not model global strategic economy, auction hostile traffic, optimize naval supply chains, or guarantee blockade of every voyage. Shipping laws are inherited. World-scale commercial trials, integrated staging with E2/E3/E5 changes, physical GPU/browser witnesses and release gates remain the Conductor's responsibility.

DO NOT MERGE before the **exact final head** has green CI and the Manager evaluates the genuine integration ledger.
