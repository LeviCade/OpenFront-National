# C5 Third Class E3 — ECON-04/05 versioned imperial member economic charter

## Source and constitutional attribution
- Base `1c700c46ff981a5857ead6f4ad63636448b7478d` (prior Class Two accepted). This third-class change adds delegated member economic responses, not already-existing sovereign sanction issuance, emperor secondary enforcement, existing bilateral embargoes, or ship/rail commerce.
- D-009, D-011, D-014, D-016 in `docs/11-decisions.md`; scenario sources ECON-02/03/04/05, and `docs/engineering/c4-class2-e3-economic-maritime.md`.
- ECON OPEN-13 deterministic implementation choice: an external demand's presence never grants economic authority. A separate, current crown-owned, compare-and-swap charter must delegate the responding member. Epochs increment on charter replacement and each emperor decision; existing permissions remain in Player-owned embargoes.
- A foreign demand to embargo another member of the same empire does not automatically compel it. The current emperor must opt in explicitly via `allowInternal=true`; no WAR or coalition betrayal authorization follows.
- Each new restriction is exactly one member↔target bilateral Player embargo. It affects actual merchant ship and train canTrade checks at departure and settlement and carries no synthetic treasury credit. Engineer Two's existing `creditNationalCommercialIncome` and split logic are authoritative and untouched.
- Crown transfer cancels former emperor grants, clears internal-embargo authorization and bumps the version. Eliminated constituents are pruned from delegate lists with a fresh epoch. Dissolution deletes the charter. A stale user command or accepted journal receipt never revives an old epoch.

## Authenticated typed command contract
`NationalImperialAdministrationCommandSchema` **append-only** variants:
1. `set-economic-charter`: `empireId`, `expectedVersion`, `delegateIds`, `allowInternal`; incumbent emperor only.
2. `set-member-trade`: `empireId`, `expectedVersion`, `memberId`, `targetId`, `embargo`; incumbent emperor only, never a global embargo.
3. `respond-member-sanction`: same `empireId`, `expectedVersion`, `memberId`, `sanctionId`, `decision`; incumbent emperor handles an eligible pending recipient demand.
4. Existing `national_respond_sanction` gains optional `expectedCharterVersion`, required for an imperial member to use a presently active delegation but forbidden as an inherited sovereign credential.

Server derives actor from the original execution principal and authenticates at actual processing time. Recipient-facing `NationalSanctionExecution.viewFor` returns only the member's own decision, or emperor's own constituent demands. Current policy via `Game.nationalEconomicCharterFor` is recipient-specific and never trusted from a client-provided roster.

## Game-owned money witness
Run `npx --no-install vitest run --project node tests/national/C5Class3E3ImperialTrade.test.ts`.
The fixture creates a real five-nation NATIONAL match with emperor, two subordinates, independent foreign issuer, and outside target. It purchases/uses actual ports and railroad, records positive ship and train gold at ordinary settlement, and then checks delegated embargo results in zero further trade income and zero new imperial treasury credit. Emperor override restores only that bilateral route. Follow-on cases exercise in-empire coercion, explicit refusal and foreign enforcement, stale CAS, forged principal/issuer, receipt replay, crown switch, empire dissolution, private views, and deterministic Game snapshot/restore.

Witness log tag: `C5_E3_IMPERIAL_TRADE_WITNESS=`. Cumulative gold readings are explicitly not per-decision deltas.

## Cross-owner conflict matrix
| Path | E3 insertion | Integration steward |
| --- | --- | --- |
| `packages/engine-api/src/Schemas.ts` | append union and optional member epoch | Conductor must preserve E2/E4 append ordering |
| `packages/engine/src/national/NationalRuntime.ts` | private charter map/query and optional snapshot row | E2 owns separate treasury fields and revenue split |
| `packages/engine/src/game/GameImpl.ts` | 3 command cases, read adapter and replay check | Conductor handles shared GameImpl integration |
| `packages/engine/src/game/Game.ts` | read accessor | Preserve all E2/E4 methods |
| `packages/engine/src/execution/NationalSanctionExecution.ts` | recipient authority and emperor decision | E3 owns |
| `tests/national/C5Class3E3ImperialTrade.test.ts` | new five-nation live evidence | E3 owns |

Release/Manager points are not asserted. Test logs are automated Game simulations, not proof of independent human clients or physical GPU.
