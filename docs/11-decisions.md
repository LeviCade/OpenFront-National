# 11 — Decision register: agreed direction and open questions

**Purpose:** avoid losing the latest user-approved constraints in a sea of hypothetical ideas. This register is authoritative for *product direction*, not a substitute for detailed specs. Changes require a documented decision and scenario update.

## Locked product direction (CORE)

| ID | Decision |
| --- | --- |
| D-001 | NATIONAL sits above Impossible as an optional Solo FFA strategic mode. |
| D-002 | Every nation wants to win; human identity does not influence AI targeting; equal legitimate information and mechanics; no artificial anti-leader dogpile. |
| D-003 | Last sovereign wins. Only one independent nation or one empire can remain; land percentage alone never ends NATIONAL. |
| D-004 | Independent Sovereign Victor and imperial sovereign Imperial Victor have equally high prestige; surviving subordinate Empire Victors are legitimate but lesser prestige wins. |
| D-005 | Independent nations resist empire submission. Inferior current power or low abstract win chance alone is insufficient; require credible existential deterioration, endangered options, and a desirable surviving empire. After membership, pursue empire win with full effort. |
| D-006 | NAP, MDA and Empire are the only initial coalition categories, replacing ordinary Ally/Betray controls in NATIONAL. Independent nations may join multiple ordinary coalitions. |
| D-007 | NAP/MDA have constitutions for admission, discretionary expulsion, enforcement and governance. Constitution amendments require unanimity. Sovereign exit requires Betray, always allowed, and always causes expulsion; prohibited co-member attacks require betrayal first. |
| D-008 | Defense treaties execute instantaneous weighted troop levies at actual incoming attack time, before territorial loss. Only enough troops are pulled; every contribution is conserved. |
| D-009 | Empire has exactly one supreme Imperial Nation. Every member including emperor is barred from membership in any other coalition; member states cannot unilaterally betray/secede. Emperor can dissolve empire and transfer leadership. |
| D-010 | Emperor exclusively controls imperial external sovereignty and can delegate member-specific national declarations/peace. All empire-wide wars require imperial control. Imperial and national wars can coexist; settling one does not erase the other. |
| D-011 | Emperor unilaterally sets treasury, spending/building, national war/peace and defense response, trade/embargo, military centralization (fully centralized, hybrid, decentralized), and troop transfer policies. |
| D-012 | Ungovernable triggers only when emperor is strictly lowest across all eight metrics at once, followed by ten-second transfer-or-collapse window. Leader elimination without transfer collapses empire. |
| D-013 | Empire accession only by emperor invitation + applicant acceptance or applicant request + emperor acceptance. Coercive demands are threats, never automatic annexation. |
| D-014 | Default diplomatic state is peace. Formal declaration required before offensive military action. Peace requires proposal + acceptance. An embargo may exist in peace. Piracy requires war. |
| D-015 | Naval blockade physically intercepts neutral merchant traffic heading to blockaded wartime enemy and turns it toward home without revenue; actual enemy ships can be pirated. |
| D-016 | Formal secondary sanctions demand that recipients stop trading with a target or face issuer embargo; recipients choose freely. Emperor alone can commit the whole empire; national delegated responses to outsiders remain possible. |
| D-017 | External coalition membership rosters are public; detailed constitutions hidden from outsiders; invited party sees terms. Basic foreign force/structures/ships are hidden without legitimate visibility. All empire members share intelligence. |
| D-018 | In-flight missile still hits after peace; already-sailing naval transport reaches one landing tile and returns rest; active land attack halts/returns when effective peace genuinely begins. |
| D-019 | Economy overhaul (multiple currencies, goods, debt, collateral, market notes, standardized structure prices, removal of discounts) is **deferred to a different version**. |
| D-020 | Stage 1 vision documentation, Stage 2 upstream migration, Stage 3 feature coding, sequentially. |

## Recommended initial values (not immutable)

- MDA levy cap: up to **10% of available troops per eligible contributor per attack campaign** while preserving **30% of total national capacity** as minimum home reserve.
- Hybrid imperial contribution threshold: surplus above **60%** of each member's cap flows to imperial army when there is capacity.
- Border structures visible within **100 tiles**.
- Ships visible within **200 tiles** of coastline or observing warship.
- Ungovernable warning: **10 in-game seconds** is core, subject to simulation clock mapping and accessible visual presentation.
- Initial diplomacy UI: no real-time allied confirmations for automatic levies.

## Engineering OPEN items (resolve before coding dependent work)

1. How should a universal formal declaration interact with capture of unclaimed land, preexisting raids, retaliation and possible non-sovereign simple bots?
2. Exact attack-campaign identity and time windows needed to prevent levy-by-microattack abuse while genuinely protecting successive invasions.
3. Combat interception accounting and how MDA troops return if attacker retreats.
4. Simultaneous cross-alliance obligations allocation, fairness and determinism.
5. Naval blockade zone geometry, neutral ship return navigation, port destruction and loop protection.
6. What happens to empire-wide war records on spontaneous empire collapse and which former members inherit legal hostilities?
7. Empire dissolution troop redistribution and treatment of already-deployed expedition forces; no loss/duplication.
8. Scope/visibility of ordinary coalition partner statistics and whether regional recon should disclose precise or approximate units.
9. Actual global/region map scale versus proposed 100-/200-tile sight radii.
10. Timeout, disconnection and AFK handling under last-sovereign victory (must not revive 80% shortcut).
11. Full governance model in a coalition with no permanent administrator, and tie/deadlock handling.
12. Whether pacts can set custom levy contribution caps/thresholds and when changes take effect relative to attacks.
13. Detailed sanction deadlines, post-deadline enforcement timing and how reputation changes are observed, not supernatural.
14. Exact handling of missiles and troops under simultaneous peace, war renewal and imperial transfer.
15. Exact member admission transition while old coalition obligations and national wars still exist.
16. License/trademark/asset provenance and upstream migration method at Stage 2.
17. National AI planning cadence, strategic personality variance and measurable performance budget.

**Do not silently assume an open item is agreed.** Implement a minimal deterministic decision only after writing rationale, edge tests and updating this register.

## Deferred options that are NOT current commitments

- Sovereign secured credit, credit ratings, tradable notes, a central bank and collateral surveillance.
- National currencies, resource goods, supply chains, price discovery, GDP-based interest-rate calculation.
- Construction discounts overhaul and uniform city/factory/port/silo/warship/SAM prices.
- Negotiated gold-for-peace guarantees, financial peace collateral, territorial concessions and compulsory fixed peace periods.
- Deep intelligence espionage minigames or intelligence rules that allow bypassing secret coalition constitutions.
- Forced annexation without explicit acceptance through an ultimatum.
- Permanent member-state unilateral secession or broad discretionary imperial expulsion.
- All game modes inheriting NATIONAL rules by default.

## Change control

Every change must cite an ID, explain national-interest consequences, provide enforceable state transitions, respect fair AI visibility and add acceptance scenarios. "It seems realistic" is not enough if it creates contradictory wars or invisible unlimited liabilities.
