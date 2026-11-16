# E1 Round Four — canonical GAME-owned WAR/LEVY persistence and political consequences

## Verified source and ownership

- Branch starting integration SHA: \`a4b0307a39fad2b65fb7848aa111e48e504fc5ef\`.
- PR: #23 -> \`stage3/integration-20261115\`.
- First committed contract: \`d21ba776695389c6c46577102dbb0b0381c411fb\`.
- Published to Issues #10 and #11 before building the broader slice.
- Only E1-owned \`Game.ts\`, \`GameImpl.ts\`, political modules, and new real-game test files were changed. No E2 \`AttackExecution\`, E2 schema/dispatcher, or E3 observation/worker edits.

## Canonical live WAR/LEVY service (E2 and E3)

\`\`\`ts
// Available on every Game, but null outside opt-in NATIONAL Solo games:
game.nationalWarAuthority(): Readonly<NationalWarAuthority> | null
// .authorizeOffensiveAction(attackerId, targetId | null): boolean
// .atWar(a, b): boolean
// .snapshot(): NationalWarStateSnapshot
game.nationalWarState(): NationalWarStateSnapshot | null
// version: 1
// wars: ConflictLedgerState // version 1, stable layer IDs/scope
// levy: LevyLedgerState // version 1, stable receipts/caps

// Internal authenticated execution; E2 owns public intent schema and router:
game.performNationalWarCommand(actor: Player, command: NationalWarCommand): void
// declares national/imperial, proposes or accepts scoped peace

// Internal E2 _already accepted_ AttackExecution interception bridge:
game.nationalLevySource(nationId: PlayerID): TroopSource | null
game.applyNationalDefenseLevy(attacks: readonly IncomingDefense[]): readonly DefenseResult[]
\`\`\`

\`GameImpl\` constructs one \`NationalWarStateService\`, which in turn owns the
**actual E2** \`WarLedger\` and \`DefenseLevyLedger\`, bound to the existing
\`Game.nationalPoliticalAuthority()\` / \`NationalRuntime\`.
There is NO shadow political registry. No module WeakMap or non-snapshotted war
history. Read-only authority is frozen and survives political mutations because
it queries the live port. Detached state is parsed and deep-copied.

\`applyNationalDefenseLevy\` validates formal WAR legality through the real
war ledger, \`confirmedAccepted === true\`, and that every contributing
TroopSource is the exact canonical source for a living, spawned real Player and
is a current MDA co-member of the defender. The source wrapper does not store
a second troop balance: it reads \`Player.troops()\`. The engine's single-threaded
synchronous tick lock stages a complete batch CAS, rejects invalid/foreign
sources and stale/unsafe balances before any mutation, and applies exact
debits with actual \`Player.setTroops()\`. E2's
\`DefenseLevyLedger.interceptAcceptedAttacks\` retains the deterministic
per-campaign caps and processed attack receipts. On replay, it returns zero
new interception, never double-deducting.

**Trust boundary:** The game method is an _internal execution interface_, not
a client RPC. \`confirmedAccepted\` is a declaration by the E2-owned execution
after it verifies a stable accepted attack and performs final troop deduction;
it is NOT independently verified by a signed server or a public packet. E2
must call this only from its accepted-attack transaction before first tile
conquest, and apply \`remainingAttackingTroops\` once. No claim that external
commands, all combat paths or hostile browsers are integrated.

## Persisted GAME snapshot migration and replay

\`GameSnapshot\` advances **v2→v3** and adds nullable \`nationalWar\`.
The old v1→v2 migration remains intact. For pre-bridge v2 NATIONAL saves,
\`nationalWar:null\` means the world predates ledger support: restore constructs
a brand-new empty canonical E2 WAR/LEVY ledger and keeps the existing
political state. For legacy modes, WAR/LEVY is strictly null, no new runtime
state or winner behavior is created.

NATIONAL v3 saves include typed, versioned WAR and LEVY states:
all imperial/national scoped war layers, completed and pending peace motions,
the last formal conflict tick, MDA allowance budgets, processed attack
receipts, and exact debit outcomes. The canonical snapshot is included in
the Game's deterministic hash and preserved during serializable round trips.
Both ledgers validate and restore atomically into a candidate service.

## Political consequences (not merely projections)

1. **COAL-05:** a live NAP/MDA blocks declaring war; a legal authenticated
   Betray removes protection; no WAR-layer or treasury mutation happens when
   the declaration is rejected.
2. **COAL-06:** a consented empire accession changes future authority and
   dynamic imperial-war participants through the original \`WarLedger\`.
   The immutable \`ConflictParty { kind:"empire", id }\` is preserved.
3. **SOV-04/WAR-07:** transferring the crown immediately changes who may
   declare and negotiate for the empire and its member's national wars.
   The original imperial war ID survives the transfer unchanged.
4. **WAR-04:** ending an imperial war closes only its selected imperial
   record; an existing constituent national war remains active. Its
   peace motion and ended tick persist after snapshot/restore.
5. **SOV-06:** elimination/dissolution changes membership, never silently
   deletes WAR history. An imperial party that no longer exists becomes
   ineffective for live hostility, while independently declared national
   layers continue to affect their belligerents. No imaginary reparations.
6. **LEVY-01/04/06/07:** formal war and current MDA contribution, atomic
   real-player debit, per-campaign cap, deterministic duplicate replay,
   exact snapshot restoration, and full-batch rejection for spoofed sources.

## Disabled/unresolved features

- P3: no automatic redistribution of pooled armies, treasuries, or in-flight
  orders. Expired Ungovernable countdown preserves warning and does not
  dissolve a multi-member empire.
- P5: no live automatic unspawned forfeiture.
- E2 still owns client auth schema, war command creation in dispatcher,
  actual AttackExecution accepted-attack trigger, and applying post-levy
  remaining attacker troops. E1 only supplies Game-owned authoritative state,
  accepted-attack contributor CAS and read-only legal queries.
- E3 owns outbound player-filtered observations and worker packets. Never
  forward a raw Game snapshot, private pact terms, or the entire ledger
  to an untrusted client without E3's visibility filter.
- Solo browser security is honest-client UX, not an adversarial browser
  confidentiality guarantee; trusted-host PvP remains a separate release gate.

## E3/E4 public political read view

`Game.nationalPublicPoliticalView(): NationalPublicPoliticalView | null`
enumerates only sorted `empires:{id,leaderId,memberIds}[]`, the existing
ten-second Ungovernable `warnings`, and the complete (nullable) `victory`
roster, all derived from the same persisted `NationalRuntime`. A detached
copy cannot mutate the Game. It expressly omits NAP/MDA terms, invitations,
private governance votes, hidden unit positions or the raw WAR/LEVY ledger.
`null` is returned in legacy games. E3 must whitelist and serialize these
facts into authorized outgoing packets; E4 must use authoritative packet
acknowledgements before treating a button click as successful. This E1
Game-only service does NOT claim to implement E2's wire action schema or E3's
worker output.

## Real-game acceptance

\`tests/national/LiveWarPoliticalState.test.ts\` uses the actual \`GameImpl\`,
\`SpawnExecution\`, actual \`PlayerImpl\` troops, registered political commands,
authoritative WAR/LEVY ledgers, WarLedger formal war, and
\`snapshotGameData\` / \`roundTrip\` save/restore. Legacy FFA and prior
Round One–Three E1 suites remain unchanged. See PR #23 for exact-head CI.

## Conductor Round Five integration review

This PR supplies canonical war state and a public political view.

- E2 owns external combat and troop debit execution.
- E3 owns filtered worker/public game packets.
- E4 owns UI consumption and user feedback.
- E1 owns authoritative MDA contributor enumeration.
- Missing MDA enumeration must never imply an approved levy.
