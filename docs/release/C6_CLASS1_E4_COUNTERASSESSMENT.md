# C6 C1 E4 — Counterassessment shield: Sixth-original M7 proposal

**Inherited ancestry:** Sixth founding `1e8da462d357cf839af2cad448fa027e40735d36`; Fifth E4 exact head `bef30abb0c09b49c2ba0173bf54a3315c2fdc8c0`; preserved by true two-parent merge `62867146b63eeb888add889b096c9ab864a8d57e`. All historical Fifth 1,200-gold assessment and 900-tick reporting behavior remains credited to PR #184, not Sixth.

## New paid gameplay and balance

- **Defender pays 1,800 real Player gold**, not a synthetic budget and not the enemy's purchase. Active shield duration is **600 authoritative ticks** (half-open interval). This defensive expense is 1.5× the attacker’s 1,200-gold one-time report purchase but protects future purchases for only 2/3 of that report's 900-tick lease. The shield is not an automatic veto of legal enemy information.
- One active shield per nation; repeated request IDs never charge again. At most 512 active shields, 4,096 durable shield receipts, 2,048 active intelligence grants, and 4,096 assessment receipts. Fail before payment at capacity, no overlapping renewals. Old receipts persist beyond expiry and snapshot.
- The target's **actual** treasury/troops are captured at the future buyer's paid purchase time. The unshielded tiers are gold 2,500, troops 100,000; the shielded tiers are gold 10,000, troops 400,000. Both are lower-inclusive, upper-exclusive intervals, mathematically containing the original real integer. `shielded-coarse-estimate` is mandatory when widened, never false figures. A paid lawful report still appears; same-empire reciprocal allies receive the original tier.
- A report purchased before shielding retains its historic immutable bands and `coarse-estimate` marker. A report purchased while the shield was active keeps its historical widened bands even after shield expiry, not a new observation. Expiration restores baseline precision for **future purchases**. Crown change does not transfer shield ownership to a different nation; death disables new purchases and purchased reports respect preexisting death/entitlement revocation.

## Authority and privacy

- A browser may submit only `national_buy_counterassessment` and opaque request ID. `Executor` resolves the **server-stamped clientID**; the real Game player is verified by the existing national principal gate, charged with `removeGold`, and checked for life/spawn/NATIONAL admission. No target, payer, amount, TTL, packet precision or empire claim from the client is authoritative.
- Existing `NationalAssessment` service owns both shield receipt ledger and immutable report ledger, under `GameImpl`; its snapshot restores to the historical v6 Game field `nationalAssessment`. An optional `shields` field in the embedded v1 schema migrates old v6 reports with an empty shield ledger. Game state hash already includes the whole assessment snapshot. The new queued execution is separately registered for deterministic replay.
- Human/AI use the same recipient-filtered projector. The strict trusted host/browser wire validates precisely the declared width and alignment matching confidence; any extra precise value, shield receipt, foreign recipient, malformed numeric band or bogus TTL fails. Spectator, public replay and independent private seats never receive the field. `FrameNormalizer` continues to drop `nationalAssessments` unconditionally.

## Reproduce

```sh
npm run inst
npm run typecheck
npx --no-install vitest run --project node tests/national/C6Class1CounterassessmentShield.test.ts tests/national/C6Class1CounterassessmentWire.test.ts tests/national/C5Class3PaidNationalAssessment.test.ts tests/national/C5Class3AssessmentWire.test.ts
npm run lint
npm run format:check
npm run build-prod
npm test
```

## Integration conflict matrix (Conductor owns final)

| File                                                                          | Sixth E4 symbols / lease                                                                          | Collision                                                |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `NationalAssessment.ts`                                                       | `buyShield`, `isShielded`, immutable widened confidence + snapshot receipts                       | **E4 owned**                                             |
| `NationalCounterassessmentExecution.ts`                                       | new stamped execution + snapshot                                                                  | **E4 owned**                                             |
| `Schemas.ts`                                                                  | add `NationalCounterassessmentIntentSchema` and zbin discriminant                                 | E2/E3/others append own intent cases                     |
| `Game.ts` / `GameImpl.ts`                                                     | `performNationalCounterassessment`, purchase-time effective width, restored shield identity       | E2 relief and E3 settlement snapshots; keep v6 fields    |
| `GameUpdates.ts`, `NationalAssessmentView.ts`                                 | explicit shield confidence union + trusted band alignment                                         | E1 native UI MUST consume marker and lawful DTO          |
| `ExecutionManager.ts`, `ExecutionRegistry.ts`                                 | append new counterassessment execution name                                                       | E2/E3 execution types                                    |
| `NationalOutbound.ts`, `LiveObservation.ts`                                   | unchanged inherited recipient projector                                                           | E1/E5 must consume reports, never raw ledger             |
| `TrustedNationalSession.ts`, `NationalRecipientWire.ts`, `FrameNormalizer.ts` | unchanged Fifth host/client firewall and replay drop; shared validator now supports shield marker | Transport code conflicts must preserve recipient binding |

**Attribution and status:** Not certified, no Manager percentage, no self-merge, no main/deployment. Real three-seat Private GameRunner/host packet, gold debit, snapshot, ledger caps, FFA, hostile wire and inherited regression are the test gates. External privileged WSS/physical GPU/human witnesses are not claimed.
