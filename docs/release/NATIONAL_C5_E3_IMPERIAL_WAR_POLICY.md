# C5 / First Class / E3 — Imperial WAR transition policy (WAR-08)

**Source:** Fourth Conductor C2 E1 `f912d8ca5cd1dd9964f71a146ca4dcdbbece39a9`. Attribution: the original canonical `NationalWarState`, war/peace motions, crown transfer, and dissolution were inherited. This decision note covers _only_ new C5 E3 policy enforcement.

## Constitutional rule and deliberately narrow choices

1. **Default `none`:** An independent nation that enters an empire retains every live national WAR. Neither the sovereign's arrival nor an emperor's earlier private wish silently adds empire-wide war. A standing intervention policy must already be enacted through the incumbent emperor's authenticated, persisted, versioned `set-war-policy` command.
2. **Opt-in `imperial`:** At actual _two-sided_ consent, the canonical WAR ledger selects the accession candidate's original active **national** wars against _independent_ third-party nations. It opens one **imperial** overlay per independently hostile opponent not already in that imperial conflict, provided no current treaty prohibits it. Original national layer ID, side identities, start tick, history and existing peace motions remain untouched. New overlay is owned by the stable empire ID, never by the crown holder as a separate sovereign.
3. **No inferred foreign-empire intervention:** A candidate at national war with a **constituent of another empire** keeps that original national layer, but no automatic imperial war against that whole foreign empire is asserted. Such escalation requires an explicit, duly authorized imperial war. This intentionally defers a constitutional ambiguity rather than writing an invented retaliation rule.
4. **No automatic pact betrayal:** Where an existing NAP/MDA protects the prospective belligerents, accession does not auto-betray. The original national war remains and the impossible automatic imperial overlay is skipped; a separate authorized treaty exit can precede an explicit imperial declaration.
5. **No enemy accession:** Admission of a candidate still in a national war with an existing member of the receiving empire fails _before_ consent commits; first negotiate and accept national peace. There is no new legal category of internal war in an empire.
6. **Delegation:** Only the emperor may set per-member permission to declare that member's national WAR or propose/accept that member's national peace. Permission is independent for the two actions; grants are explicit and revocable. No delegation ever empowers a subordinate to declare, negotiate, or settle empire-wide war.
7. **Policy compare-and-swap:** `expectedVersion` must equal the existing authoritative `warPolicyVersion`. Every policy mutation and former peace-only delegation mutation increments the epoch. Crown transfer increments it and revokes grants. The queued, trusted WAR execution persists its original admitted empire and policy epoch in Game snapshots and verifies them at execution. This prevents accession, revocation, regrant, succession, and dissolution from upgrading a stale click. Human session identity is rechecked independently.
8. **Peace and collapse:** Imperial peace ends only the imperial layer. A surviving national WAR is still the legal basis for military attack. On dissolution the inherited policy retires imperial layers without imposing involuntary national WAR inheritances on newly independent former members. No new attacks may rely on a retired final layer; the existing Game WAR authority remains the single gate.
9. **Ordering:** Canonical GameRunner tick order governs political commands before subsequent WAR commands. Accession first preflights the live ledger and takes actual consent, then atomically applies the standing response in the same trusted command execution. No asynchronous timers, wall clock, client-provided sovereign IDs or second conflict ledger.

## Explicitly OPEN / not claimed solved

- D-011 targeted defensive levy remains separate from accession policy; `imperial` here means war overlay, not free levy.
- The original open decision on exact _involuntary empire dissolution_ war inheritance persists. Existing `retireEmpireWars` ends extinct imperial layers and preserves national layers. Any different inheritance needs sovereign authority and a recorded product decision.
- Full post-peace in-flight transports, missiles and land troops are inherited engine behaviors; the C5 scope does not rewrite those execution paths.
- Full private production host, real 3-human independent acceptance, physical GPU, OAuth and public release are not certified by these source tests.

## Reproduction

```sh
npm run inst
npm run typecheck
npx --no-install vitest run --project node \
  tests/national/C5ImperialWarPolicy.test.ts \
  tests/national/ConductorTwoCrownWarContinuity.test.ts \
  tests/national/LiveSovereignty.test.ts
npm run lint
npm run format:check
```

For authoritative result and exact source SHA, inspect the C5 E3 GitHub Actions run attached to draft PR #155. A _committed_ scenario is not a successful runtime execution until the action passes; do not award credit for an unexecuted assertion.
