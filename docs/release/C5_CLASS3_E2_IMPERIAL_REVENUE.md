# C5 Third Class E2 — Imperial real-income revenue contract

Issue: [#173](https://github.com/LeviCade/OpenFront-National/issues/173). Founding SHA: `1c700c46ff981a5857ead6f4ad63636448b7478d`.

## Rule

NATIONAL alone routes **actual paid** income for four named classes: `workers`, `maritime`, `rail`, `piracy`. Every class may independently be enabled or disabled. Existing worker and non-worker percentage basis-point rates are retained.

The emperor can additionally set an **integer gold contribution per successful payment event**: `fixedGoldPerPayout` (canonical, nonnegative decimal string, at most 128 characters). It is a quota *per recipient payment*, not a periodic tick levy, per-empire subscription, debt, or assumed income.

For a positive real gross credit `G`, enabled class, appropriate legacy basis-point rate `R`, fixed quota `F`:

1. `percentage = floor(G * R / 10000)`
2. `fixedCharged = min(F, G - percentage)`
3. `imperialCredit = percentage + fixedCharged`
4. `personalCredit = G - imperialCredit`

**Invariant:** `G = imperialCredit + personalCredit` in exact bigint arithmetic; both credits are nonnegative. A 100%-rate captures all real income regardless of fixed quota. A fixed quota greater than the gross payout captures only the gross. A disabled class is entirely exempt even if both the rate and quota are positive. A zero payout contributes zero. The fixed quota is never independently debited from an existing personal wallet.

All receipts enter the **existing** `NationalRuntime` administration row treasury. `GameImpl.creditNationalWorkerIncome` calls the route from actual `PlayerExecution` production. `GameImpl.creditNationalCommercialIncome` requires the source and calls the same routing from:

- `TradeShipExecution.complete`: lawful ordinary deliveries = `maritime`, lawful captured-ship payout to captor = `piracy`; recaptured-by-original-owner payout = `maritime`.
- `TrainStation.onTrainStop`: physical train-stop credits to locomotive and/or station owner = `rail`.
- In **legacy FFA**, an old unclassified `creditNationalCommercialIncome(player, gross)` still credits the wallet unchanged. In **NATIONAL**, missing source fails closed, rather than guessing and taxing unintended gold.

Neither donations, conquest, generic `Player.addGold`, treasury-spent construction nor scheduled empty ticks call this routing. If war, embargo, loss of port or naval blockade suppresses the actual trade payout, **no imperial gold** is generated.

The existing `tradeGold`, `trainGold`, and `piracyGold` counters record **gross economic production**, not the recipient's after-decree balance. The player wallet's `goldEarned` tracks only the personal credited share, consistent with how its `addGold` already functions.

## Policy authority, schema and restoration

- `NationalImperialAdministrationCommandSchema` extends the **existing** `set-policy` variant with optional `fixedGoldPerPayout` and `revenueClasses` (strict object of four booleans). No new discriminated-union variant or request-stamp API.
- `ImperialPolicy` and member-only `NationalImperialAdministrationView` expose those fields with typed source contracts. The outbound whitelist and recipient-bound decoder accept the two new fields, reject malformed/foreign disclosure, and continue to recognize historical V1 hosts.
- `NationalRuntimeSnapshotSchema.version` remains **1**, deliberately: this is an **append-only optional row migration**, not a breaking version change. New policy rows carry `revenuePolicyVersion: 1`; earlier rows missing it and the new fields restore as `fixedGoldPerPayout: "0"` and **all four classes enabled**. Thus previous non-worker and worker percentage behavior survives. The normalized member view always reports effective defaults.
- A legacy `set-policy` request missing new fields **preserves the previous fixed quota and category selections**. It cannot silently revoke an existing decree. A newly supplied complete `revenueClasses` replaces its previous four booleans atomically.
- Army centralization, hybridization and decentralization preserve the new policy row fields alongside inherited percentages and treasury.
- Every command passes the existing original-client/actor assertion, live crown, live membership, Game-owned sovereign state and stamped governance journal before any mutation. Crown transfer preserves the policy and treasury; dissolution settles the original treasury and deletes its row. Queued commands are reauthorized when executed. Duplicate request IDs reuse the existing replay journal, not an alternative income ledger.

## Scope, integration and regression

| Path | Changed symbols | Conflict/owner |
| --- | --- | --- |
| `packages/engine/src/national/NationalRuntime.ts` | administration schema, `ImperialPolicy`, `setImperialPolicy`, view, row-copy during army transitions, income routes | E2 exclusive; E1 consumes projection |
| `packages/engine-api/src/Schemas.ts` | optional fields in **existing** `set-policy` object only | Conductor reconciles with E3/E4 appended variants |
| `packages/engine/src/game/Game.ts` / `GameImpl.ts` | typed commercial source argument and exact Game-ledger adapter | E3 owns other sanction/trade-permission hunks |
| `packages/engine/src/execution/TradeShipExecution.ts` | four classification literals at existing paid sites | Preserve E3's embargo gate and paid-trade behavior |
| `packages/engine/src/game/TrainStation.ts` | two `rail` arguments at actual train-stop credits | Preserve E3's permission gate |
| `packages/engine-api/src/game/NationalImperialView.ts` | optional typed member-only wire fields and strict parser | E1 panel should consume, not overwrite |
| `packages/engine/src/national/observation/NationalPactProjection.ts` | new fields in existing private projection whitelist | No public-politics leakage |

**Do not merge this branch automatically.** Conductor must reconcile shared source by symbol, preserve E3 trade suppression and E4 secret-intelligence projections, rerun full combined acceptance on exact merged source, and obtain Manager approval for any M5 point.

## Runnable evidence

```bash
npm run inst
npx --no-install vitest run --project node tests/national/C5Class3ImperialRevenue.test.ts
npx --no-install vitest run --project node tests/national/ImperialSpendingClassFive.test.ts tests/national/C4Class2EconomicMaritime.test.ts
npm run typecheck
npm run lint
npm run format:check
npm run build-prod
```

Every `C5_C3_E2_GOLD_WITNESS` log contains actual before/after personal balances, treasury and source gross counters. Passing unit tests alone do not prove production release, physical GPU acceptance or independently authenticated three-human gameplay.
