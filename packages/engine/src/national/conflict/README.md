# OpenFront NATIONAL — Engineer #2 conflict foundations (Rounds One–Two)

**Base integration SHA:** `dacb0fe6b7e7c4dd5e681b9bf671498ee4827e6a`.

Modules: `WarLedger.ts` (layered war / negotiated peace), `DefenseLevy.ts` (atomic defensive interception), with dedicated tests in `tests/national/`.

## Round Two: single atomic levy transaction (D-008; LEVY-01..07)

The former implementation called `source.removeTroops()` sequentially and could charge donor A when donor B failed. This is removed. `TroopSource` exposes **reads only**. Every accepted attack in a batch is planned against scratch campaign allowances and scratch contributor balances, sorted by stable attack ID. **Nothing is charged during calculation, including simultaneous multi-attack planning.**

The ledger then calculates a sorted, consolidated debit request and calls exactly one transaction adapter:

```ts
interface TroopDebit {
  readonly source: TroopSource; // { nationId: string; troops(): number }
  readonly expectedBalance: number; // authoritative, before this batch
  readonly debit: number; // positive integer, consolidated
  readonly resultingBalance: number; // expectedBalance - debit
}

interface PreparedTroopDebits {
  readonly approved: readonly {
    nationId: string;
    troopsDebited: number;
  }[];
  commit(): void; // ATOMIC ALL-OR-NOTHING CAS; cannot partially mutate
  discard(): void; // discard without any balance mutation
}

interface TroopDebitTransactionAdapter {
  prepare(debits: readonly TroopDebit[]): PreparedTroopDebits;
}
```

The constructor is `new DefenseLevyLedger(transactionAdapter)`. The entrypoint remains `interceptAcceptedAttacks(requests: readonly IncomingDefense[]): DefenseResult[]`; each request must include `confirmedAccepted: true` from the **authoritative engine**, not a client assertion.

**Hard transaction obligations for conductor M0:** `prepare` must be side-effect-free (including when it throws), return an exact full approval in input order, and may never reserve or remove troop balances. The ledger validates approvals, checks initial balances again, and only then calls `commit()`. The adapter's `commit()` must compare _all_ authoritative balances to expected values and apply _all_ exact resulting values as **one indivisible change**. On a stale value or _any_ exception, it must leave **every balance unchanged**. On success, it must not return early or partially apply. A loop calling `Player.removeTroops()` is **not** a compliant adapter. An engine lock, single transactional state swap, or equivalent validated nonthrowing atomic operation is required. The adapter must prohibit callbacks/reentrancy between the balance commit and the ledger's immediate single state swap. Do not implement an adapter that silently short-debits.

The ledger publishes its scratch allowances/processed IDs **only after** the commit succeeds. Preparation failures, incomplete/incorrect approvals, stale balances, and failed atomic commits do not change ledger state. No-debit accepted attacks are still recorded once to prevent repeated triggers. Restores never debit and rely on same-boundary snapshotting of authoritative troops **plus** the ledger. Replaying an already processed attack is a no-debit lookup.

**Limit:** The isolated module cannot make a deliberately nonconforming external adapter atomic. The conductor must implement and independently test the above engine-level guarantee. The test adapter computes all destinations before publishing through a single bank-state reference swap, including exceptions injected at the second/final contributor.

## Explicitly unsupported / disabled

- **No levy refunds on attacker retreat.** How much of already intercepted force can return, if any, is OPEN; no refund/return API exists in this module. Do not invent one.
- Campaign identity and time boundaries are OPEN. M0 must provide stable grouping so microattacks reuse allowances.
- NATIONAL live attack authorization, real combat casualties, naval/missile in-flight peace, and atomic game snapshot wiring remain **conductor-owned and NOT IMPLEMENTED** here.
- The root snapshot does not yet persist these ledgers. Isolated export/restore is **not** evidence of integrated replay.
- No existing legacy game mode, dispatcher, `AttackExecution`, `GameImpl`, schema, or snapshot framework is modified.

Run `npm run typecheck && npm test && npm run lint && npm run format:check && npm run build-prod` in the full repository. Passing isolated tests does not prove live NATIONAL warfare until M0 connects the transaction adapter and execution routing.
