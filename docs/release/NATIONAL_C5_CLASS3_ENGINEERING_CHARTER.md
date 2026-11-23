# Fifth Conductor — Third Class engineering charter

**Manager-certified entry: 73%. Mandatory five new points: 78%. Proposed six-new-point target: 79%.** Certification belongs exclusively to the Manager and the official [Issue #20](https://github.com/LeviCade/OpenFront-National/issues/20). The Manager's Third-Class letter is the controlling commission.

## Source and prior credit

Canonical founding SHA: `86b476d3ea8aa04821f2caac421738fe2fe1db21`, merged PR #165.

The previous classes already earned points for constitutional sovereignty, foundational MDA/imperial WAR, actual troop levies, centralized military power, empire treasury and structure administration, native upgrade/demolish controls, signed local TLS/WSS admission, real sanctions/embargo/piracy, imperial ultimatums, reciprocal and paid regional sight, rational coerced-accession AI, and authenticated real Game/Worker durable recovery. Do not recast any of those as Third-Class invention.

The First and Second Classes' accepted tests (11,954 and then 12,016, respectively) establish the **historical** baseline. They do not certify future combined source.

## Conductor-owned Class Three preparation

The engine already accepts `national_buy_regional_recon`, but the ordinary native transport lacked a typed user-originated route. The Conductor adds `SendNationalReconnaissanceIntentEvent`, strict `parseNationalReconnaissanceIntent` ingress, hostile-form rejection, and focused real recon GameRunner and client tests. It uses current authenticated NATIONAL transport authority and the original Game-owned debit. It does not yet claim a human-facing purchase UI or a new certified point.

## Six independent ORIGINAL missions

- **E1 — M9:** Native recipient-private human ultimatum and regional reconnaissance purchase UX, including real map location, authentic confirmation and receipt-based results. Depends on the Conductor's existing purchase-transport bridge. No points for past imperial works or seven pact controls.
- **E2 — M5:** Fixed-amount treasury contribution and revenue-class selection on real existing gold payouts; atomic server-only accounting, saved policy and no extra currency. Distinct from previously credited percentage splits.
- **E3 — M6:** Delegated/overridden member-specific imperial external economic sanctions and actual trade restrictions. The current sanction recipient implementation excludes all imperial members. Distinct from the previous emperor-issued sovereign/imperial secondary sanctions and embargoes.
- **E4 — M7:** Gold-funded, temporary NATIONAL ASSESSMENT of one target's strength/economy as bounded, recipient-private intelligence. Distinct from the already credited 500-gold 90-tile regional sensor. No secret constitutions or full foreign Game state in public packets.
- **E5 — M8:** NATIONAL bot decides to **purchase** existing paid regional reconnaissance with real own gold, then changes subsequent lawful action based on newly observed assets; deterministic AI memory/response and human parity. Distinct from passive free visibility, coercion AI, and prior automatic sanctions.
- **E6 — M8/M6:** Observed NAVAL economic warfare AI: legal purchase/deployment of warships toward observed enemy trading lanes under actual WAR, changing real naval blockade/merchant trade outcomes; the existing passive NAV-02 engine and generic NationWarshipBehavior are inherited and uncredited.

All six engineers work from one identical, explicitly identified frozen branch commit supplied in the commission. They open DRAFT PRs targeting `stage3/conductor5-class3-integration-20261122`. No engineer may merge, modify Issue #20 or claim GPU/release acceptance.

## Shared-source conflict and leases

**Conductor:** `src/client/Transport.ts`, the source-only client reconnaissance parser and common acceptance workflow. Engineers must preserve this exact source. No competing political state, custom transport authority or separate canonical accounting.

**E1:** native `NationalDiplomacyPanel.ts`, scoped UI state and tests. In particular, consume but do not overwrite the E0 recon event and helper. Create UX only for currently authenticated, alive and legal actor.

**E2:** `NationalRuntime.ts` administration row, actual Player/Game income bridge, the imperial policy schema; explicit source-specific payouts. Do not change E3's sanction ledger.

**E3:** `NationalSanctionExecution.ts`, private member economic response policy, canonical trade-permission sites, bounded sanctioned receipt; narrow shared `GameImpl.ts` and `Schemas.ts` hunks. Do not rewrite E2 revenue.

**E4:** new NationalAssessment state/lease/recipient DTO and scoped `LiveObservation`/outbound integration; import only legitimate source data to an authorized projector. Coordinate `Schemas.ts`/GameSnapshot version changes with E2 and E3.

**E5:** new `NationalReconStrategy.ts` and **dedicated** `NationExecution.ts` reconnaissance decision/memory hook. Read `NationalObservation`, not unrestricted Game state; only canonical `national_buy_regional_recon` action. E4's higher assessment is optional and should not be copied into this branch.

**E6:** new `NationalNavalStrategy.ts` and `NationWarshipBehavior.ts` policy. Reuse existing nation behavior scheduling; do not edit E5's reconnaissance portion of `NationExecution.ts`. The observed lawful WAR view is mandatory, and all Legacy FFA behavior is unchanged.

The Conductor merges all shared authoritative `Schemas.ts`, `GameImpl.ts`, `NationExecution.ts`, `NationalOutbound.ts` and snapshot changes. Each PR must provide a conflict/lease matrix of changed paths and named insertion functions, plus a minimal typed cross-owner contract.

## Evidence contract and release boundary

Each engineer shall publish: exact founding SHA and final head SHA; real source/diff; red-first known bug or failing baseline where practicable; real GameRunner/Worker/native implementation; negative authorization, timing, replay/determinism, no troop/gold minting and no secret leakage; real current-source CI with TypeScript, tests, touched formatting, lint and production build; and draft PR. Report full-suite status honestly.

A planner-only fixture is not a gameplay point. A saved state type is not an executed action. A screenshot or mock is not physical GPU gameplay. Three automated WebSocket seats are not three independently verified human players. No external OAuth, public WSS host, original licensed media or trusted GPU attestation is assumed. Public release remains separately blocked pending independently witnessed authority.
