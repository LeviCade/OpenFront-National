# C6 First Class Engineer Three — bilateral enforced-embargo restitution

## Provenance
- Common Sixth charter: `1e8da462d357cf839af2cad448fa027e40735d36`.
- Fifth exact inherited source: `17ea775a94f1f12dc6e4466b35c442f2d1bd4a3a`, via the real two-parent merge `39eef0e988b1e1e994037181b4c651def8e3bd8e`. The predecessor's original commits are now reachable in the E3 branch, not rebranded as original Sixth work.
- Sixth-original implementation: `2596212edbb38a78690ef5a4e2628a8cebc914f6`, separate from inherited history.

## Protocol
- `national_offer_sanction_settlement`: actual embargoed recipient offers up to 18 decimal digits of positive **real gold** on an enforced, still-lawful sanction. No money is collected on proposal.
- `national_decide_sanction_settlement`: current enforcing original issuer alone accepts/refuses, bound to recipient, exact sanction and offer ID. Decision must occur before 120 authoritative Game ticks elapse.
- Accepted exactly once: payer `removeGold`, issuer `addGold`, then only demand-owned `Player.stopEmbargo` changes; an accepted status is durable and blocks replay.
- Rejected: no transfer on refusal, expiry, insufficient wallet, expired crown epoch, dead/foreign principals, altered embargo entry, WAR, recipient-side embargo, parallel sanction or inherited ambiguous ownership.
- **No WAR or treaty policy is changed.** The Player's existing `canTrade` still decides actual ships/trains.
- Snapshot: `NationalSanction` record v2 with v1→v2 identity migration; older already-enforced demands have no owner evidence and remain *ineligible*, by design. Trade/offer changes are in deterministic `stateHash`.
- Private views: recipient sees only its own offer; enforcing issuer sees its affected recipients; no balances included.

## Ownership limitations / fail-closed behaviors
Per-recipient enforcement rows record each owner and the exact created-at tick of an embargo. An existing owner embargo produces a null ownership tick and therefore cannot be bought away by restitution. Parallel active sanctions that touch the same owner/target pair prevent release of either while overlapping. A separate manual embargo by the recipient likewise prevents settlement. **The Player manual embargo map is not a multireason journal**: a concurrent *idempotent* addEmbargo of the same pair cannot be externally distinguished without extending Player's ledger. The release is intentionally rejected for recognized conflicting sources; integration reviewer should decide whether cross-owner expansion of Player reason semantics is required before production exposure.

## Shared-source merge matrix
| Source | E3 changed | Conductor / sibling risk |
| --- | --- | --- |
| `Schemas.ts` | Append-only two restitution intents at the end of wire discriminant union | E1/E2/E4 add schemas: preserve *all* new union variants and index assignment |
| `ExecutionManager.ts` | Route two stamped intents through existing authenticated sanction execution | Conductor merges other action dispatch |
| `NationalSanctionExecution.ts` | Per-demand ownership journal, 120-tick offer, payment/refusal/expiry, v2 snapshot, private offer views | E2 no overlap; preserve E3 imperial sanctions |
| `NationalRuntime.ts` | Inherited economic-charter code only | E2 owns fiscal fields and relief; integrate symbols, never replace |
| `Game.ts` / `GameImpl.ts` | Inherited charter reader and emperor-override source only | E2 owns revenue split; preserve both |
| `ExecutionRegistry.ts` | No change (same snapshot type tag) | Verify v2 migration alongside all combined snapshots |

## Acceptance
Run `npx --no-install vitest run --project node tests/national/C6Class1E3EmbargoRestitution.test.ts tests/national/C5Class3E3ImperialTrade.test.ts`, then typecheck, lint, pinned format, build and full regression. Positive and hostile scenarios must be proven by CI logs, not this narrative. No self-merge or numerical credit.
