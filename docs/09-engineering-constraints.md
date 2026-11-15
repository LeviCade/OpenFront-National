# 09 — Engineering architecture, invariants, and proof obligations

## Phase boundary

Stage 1 defines architecture **without importing or modifying upstream code**. Stage 2 audits actual engine types and merges upstream with license/attribution obligations. Stage 3 implements feature slices, not a single all-at-once rewrite.

## Authoritative state objects (conceptual)

- **PoliticalIdentity / SovereignUnit:** Independent nation, Imperial Nation, Member Nation; empire ID, owner, succession and status.
- **Coalition:** NAP / MDA / Empire; constitutional clauses, member roster, approval process, secrecy and amendment history.
- **TreatyMembership:** Join/leave/betray times, applicable terms, expulsion and membership transition.
- **WarRecord:** Stable ID, national or empire-wide scope, participant sovereigns/nations, legal belligerents, initiation and termination.
- **PeaceMotion:** Parties, targeted war record(s), proposer, expiry, acceptance tick, valid negotiating authority.
- **Embargo / SanctionsDemand / Ultimatum:** Issuer, covered trade relationships, recipients, consequences, deadlines and enforcement status.
- **DefenseCommitment:** Target attack/campaign, contributing member, troops deducted and committed, remaining allowance, provenance and return/destroy outcome.
- **ImperialPolicy:** Delegated national war/peace authority, automatic defense, treasury categories and rates, construction permissions, military mode and trade controls.
- **IntelligenceObservation:** Subject, data class, source visibility rights, grant/expiry, last-known time; shared visibility rights for empire.
- **NationalStrategicState:** Objective, observations, uncertainty, diplomatic memory, expected outcomes and committed strategy.

Types are a target model, not a claim that these types exist upstream.

## Non-negotiable invariants

1. **Conservation:** Gold and troops cannot appear through consolidation, levy, transfers, collision or liquidation. Money created by underlying game revenue must follow existing valid economics. A treasury cannot pay twice from one balance.
2. **Sovereignty:** A surviving nation belongs to at most one empire; no empire member has outside coalition membership; one empire has exactly one living Imperial Nation; every national peace/war action has authorized actor.
3. **War identity:** Distinct national and imperial wars persist independently. Ending one war does not end an unrelated war. Effective hostility is a derived set, not a mutable single switch.
4. **Treaty enforcement:** Betrayal of ordinary coalition membership expels immediately; compliant members retain constitutionally protected expulsion rights. No defensive levy without an actual qualifying attack.
5. **Single-application:** The same attack/campaign cannot trigger unlimited independent levies via click spam or rapid restarts; simultaneous obligations cannot spend the same troops more than once.
6. **Fog of war:** Observation APIs enforce authorized visibility equally for humans and AI; hidden state is never sent as a convenience and accidentally exposed.
7. **Replay/serialization:** Every state transition is deterministic from committed inputs, serialized in snapshots/replays, and stable under save/load; no nondeterministic ordering from unordered iteration, local clocks or unconstrained random.
8. **Legacy preservation:** NATIONAL is opt-in and does not regress existing multiplayer, FFA, team, tutorial or legacy difficulty semantics unless expressly approved and tested.

## Suggested engine layering

1. **Political state and permissions:** sovereign membership, coalition constitution, exclusive empire authority, treaty rules.
2. **Diplomatic events:** formal war records, peace, betrayal, embargo, sanctions, ultimata and scheduled deadlines.
3. **Combat interception:** attack acceptance, true troop deduction, coalition levy arbitration and wartime ship capture/blockade behavior.
4. **Imperial shared resources:** military mode conversion, pooled troops, treasury routing, construction permissions.
5. **Observation / information:** geographic fog, public knowledge, coalition rights, empire share and intelligence purchases.
6. **AI planner:** reads observation, applies the same legal action validator, issues ordinary game commands.
7. **UI projections:** separate public and privileged views, actions, warnings, event history and victory outcomes.

Existing upstream is the integration host, not necessarily a direct mapping of these objects.

## Resolution ordering

Define one canonical deterministic ordering for a simulation tick: pending diplomatic state changes and permissions; attack execution and troop debit; defensive-levy arbitration; interception; territorial combat; death/sovereignty transitions; construction/economy; visibility/history updates; victory evaluation. Exact engine ordering may differ after upstream analysis, but the same tests and invariants must hold.

Prevent race/exploit cases: simultaneous declarations; declaration + betrayal + attack; peace accepted as missile launches; multiple attack clicks generating repeated levy caps; two wars ending in one tick; empire accession while at war; imperial policy and transfer simultaneous with collapse; blockade intercepting returning neutral vessel; an attack after its owner loses sovereignty.

## Performance

OpenFront has real-time, large-map, many-player requirements. Avoid full world scans per AI per tick. Cache strategic assessments, use event triggers, incremental visibility/indexes, bounded history, deterministic path/campaign IDs, and profile CPU and memory under large-Nation simulations. No fixed threshold accepted without benchmark results.

## Security and abuse

Server/authoritative-side validation of declarations, treaty votes, hidden terms, domestic authority, embargo scope and combat targeting. Client requests cannot assert their own visibility or empire permissions. All privileged game-state writes must be conditioned on live authority and membership.

## Stage 3 test gates

- Unit tests for each political transition and permission check.
- Integration scenarios from [10-scenarios.md](10-scenarios.md).
- Deterministic replay, serialization, compatibility, and double-charge/duplication abuse tests.
- Performance and fog-of-war leakage checks.
- Regression suites for default and legacy game modes.
- End-to-end Solo NATIONAL scenario demonstrating independent nations, empire, coercion, wars, and final sovereign victory.

No release claims until each relevant gate passes.
