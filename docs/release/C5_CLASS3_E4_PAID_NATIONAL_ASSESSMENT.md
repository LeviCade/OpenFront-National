# C5 Third Class / Engineer Four: paid national-strength assessment (M7 proposal)

**Source:** #175, `docs/07-intelligence.md`, D-002/D-017, FOG-01/07. **Founder:** `1c700c46ff981a5857ead6f4ad63636448b7478d`. **Certification:** Manager only; this independent draft makes no claim against #20.

## Distinct functionality and economic rationale

Regional reconnaissance is INHERITED: 500 gold for a 90-map-tile region and 600 ticks. This separate national-assessment tier costs **1,200 actual gold** from one authenticated Player and lasts **900 authoritative ticks** in half-open interval `[effectiveTick, expiresAtTick)`. Gold is spent, never transferred to a new wallet or lent. Relative to regional intel, the 2.4x cost purchases a broader but non-geographic coarse strength report, with only 1.5x lease duration, balancing opportunity cost versus strategic value.

The purchased report is a **fixed purchase-time estimate**, not a continuous live feed: gold range `[floor(actualGold/2500)*2500, +2500)`; military ready troops `[floor(actualTroops/100000)*100000, +100000)`. This is deterministic quantization, never randomized; no exact foreign troop/gold numeric precision, structures, landings, treaties, payloads, targets or attacker plans. The estimate is clearly labeled `coarse-estimate`. Even after target growth, the original bands do not change: there is no invisible tracking entitlement.

Only the server-side `GameImpl.performNationalAssessment` resolves real live authenticated actor and target, checks NATIONAL, prevents self-target and foreign impersonation, verifies sufficient real gold, debits exactly 1,200 and captures target figures. A failure refunds the entire charge; no request-ID receipt or grant is committed. Duplicates use a length-delimited payer/request-ID key persisted across restarts **even after expiry**, capped at 4,096 purchases per match. At most 2,048 grants may be concurrently active; the 2,049th is rejected before payment to preserve the trusted recipient-wire cap without discarding a paid report. Expiry frees active capacity without clearing replay receipts.

## Entitlement and privacy

- Game-owned `NationalAssessment` stores grant, payer ID, target ID, fixed effective/expiration ticks, immutable bands and request ID. `GameSnapshot` v6 migrates v5 to an **empty** assessment ledger; historic regional recon unchanged. State hash includes assessment purchases. Queued `NationalAssessmentExecution` retains original authenticated session through snapshot/replay.
- `projectLiveNationalAssessments` receives the Game internally, validates observer alive/spawned, then checks the current **reciprocal empireOf** for each shared member. No empire roster cache or grant transfer on accession; dissolution, departure, payer death, target death and expiry terminate access immediately. Owner and current reciprocal members may see the same bounded report; other Private seat, outsider, spectator and FFA have none.
- `collectLiveNationalObservation` exposes only the already-filtered `assessments` to AI, with no raw Game or target `Player` object. `NationalOutboundFilter` gives the same fields to an authenticated human GameRunner. Recipient-only `NationalAssessmentViewData` is explicitly whitelisted by server `NationalRecipientWire`; `NationalAssessmentViewSchema` (strict Zod) validates both server encoding and browser `TrustedNationalSession` parsing. Empty private list in authorized packet enables immediate client-side expiry. Public replay `FrameNormalizer` explicitly **drops** the private intelligence.
- Bounded view schema rejects secret extra properties, exact-value override, invalid coarse increments, invalid duration, stale/future reports and unauthorized recipients. Trusted NATIONAL packets (not public spectator streams) are the only path; no UI work overlaps E1.

## Test and proof commands

```sh
npm run inst
npm run typecheck
npx --no-install vitest run --project node \
  tests/national/C5Class3PaidNationalAssessment.test.ts \
  tests/national/C5Class3AssessmentWire.test.ts \
  tests/national/C5Class2FundedRecon.test.ts \
  tests/national/NationalLiveObservation.test.ts \
  tests/national/NationalObservation.test.ts
npm run lint
npm run format:check
npm run build-prod
```

Negative matrix: missing authentication, wrong Private seat, hidden unpurchased target, wrong original clientID, malformed request ID, self-target, insufficient balance, request replay, tampered bands, extra confidential fields, expired entitlement, stale reciprocal roster, dissolved empire, legacy FFA, restore after expiry. Snapshot replay conserves original lease ticks and replays duplicate IDs without charging twice. A 120-payer ledger and aggregate 120-report JSON witness measures serialized private payload length and indexed read lookup. This **is not a 120 live human socket/GPU witness**; it is a bounded throughput component witness. No independent physical GPU claim.

## Shared-source conflict and conductor obligations

| File/function | Our edit | Concurrent owner / reconciliation |
|---|---|---|
| `packages/engine-api/src/Schemas.ts` | append `NationalAssessmentIntentSchema` and union case | E2 and E3 append revenue/sanction intents; preserve every discriminant and existing zbin ordering |
| `packages/engine/src/game/GameImpl.ts` | separate `_nationalAssessment`, authenticated post-debit capture, `snapshotState`, `restoreState`, hash, `GameSnapshot` v6 | E2 revenue and E3 sanctions may edit same sections; merge property/version migrations, never discard other v6 additions |
| `packages/engine-api/src/game/GameUpdates.ts` | `NationalAssessmentViewData` recipient-only field | E1 private UI and Conductor packet additions; retain distinct DTO and privacy |
| `packages/engine/src/execution/ExecutionManager.ts` + `snapshot/ExecutionRegistry.ts` | append new stamped execution and snapshot registration | E2/E3 execution additions; keep unique name and registration |
| `packages/engine/src/national/observation/LiveObservation.ts` + `NationalObservation.ts` | only filtered `assessments` property | E5 read-only regional AI hook; no unrestricted enemy World exposure |
| `packages/engine/src/national/observation/NationalOutbound.ts` | authentic private per-recipient report from verified AI-equivalent observation | Conductor ensures authenticated Worker receives this only after bound principal/seat |
| `src/server/national/NationalRecipientWire.ts` + `src/client/TrustedNationalSession.ts` | strict server/client whitelists | E1 UI and E0 Transport; preserve current signed private stream, no standalone unauthenticated socket |
| `src/client/replay/codec/FrameNormalizer.ts` | drop private reports | replay producer must not archive private enemy estimates |
| New `NationalAssessment.ts` + `NationalAssessmentExecution.ts` + `NationalAssessmentView.ts` | feature-owned module, execution and validator | no concurrent owner should duplicate this ledger |

**Release:** PR stays DRAFT/UNMERGED. No new Manager-certified points, no edits to #20, no staging or main merges. Independent host/GPU/OAuth/media release gates unchanged.
