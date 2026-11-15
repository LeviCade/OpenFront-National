# 04 — Empires, supreme leadership, and constituent nations

## Sovereignty

**CORE RULE:** An **Empire** is one exclusive sovereign political entity made up of one **Imperial Nation** (supreme leader) and zero or more subordinate member nations. All members are inside the empire's sovereignty, including the emperor's own nation. An empire is not an ordinary defensive coalition or team.

No constituent nation or Imperial Nation can form or join other coalitions for as long as it belongs to the empire. Outside relations are controlled by the Imperial Nation, but certain **member-specific national diplomacy and warfare powers may be delegated** by imperial policy. The empire's collective diplomatic status is separate from each member's individual war status.

## Admission

Two symmetrical methods:

1. The Imperial Nation invites an independent nation; the recipient accepts or rejects.
2. An independent nation applies to an empire; the Imperial Nation accepts or rejects.

No third-party administrator unilaterally admits someone. Coercive ultimatums may pressure a nation to request/accept entry, but accession itself is an explicit state transition with both parties' consent. No separate automatic force-annexation mechanic is in the approved initial design.

Accession terminates outside pacts/alliances with specified betrayal or treaty-exit consequences; the interface must make those consequences explicit. Existing national wars survive accession, subject to the emperor's preset intervention/escalation policy.

## One-way membership and dissolution

Member nations cannot Betray or Leave an empire. The membership lasts until imperial dissolution, loss of leadership without valid transfer, or defined imperial collapse. The supreme leader may voluntarily dissolve the empire. The separate notion of voluntarily releasing one subordinate state is **not part of the approved core**; consider only through an explicit future decision.

The supreme leader has **unilateral amendment authority** over the entire imperial constitution. No member vote is required, including for reforms harmful to members.

## Imperial constitutional domains

Every domain except fundamental sovereignty and exclusive coalition membership may be controlled separately:

| Domain                       | Delegated / localized                         | Centralized / imperial                                                                  |
| ---------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------- |
| National war declaration     | Members can declare national war under policy | Emperor alone authorizes national wars                                                  |
| National peace               | Members may negotiate own national peace      | Emperor exclusively negotiates for them                                                 |
| Imperial war                 | Never delegated                               | Emperor alone declares and ends empire-wide war                                         |
| Response to member attack    | No response or targeted defense levy          | Optional automatic empire-wide war, levy, or both                                       |
| Economy / treasury           | Member retains income, may contribute portion | All or selected revenue classes go to imperial treasury                                 |
| Construction                 | Member can build allowed types                | Emperor builds, upgrades or demolishes member structures, paying from imperial treasury |
| Army                         | Members control national troops               | One imperial military controlled only by emperor                                        |
| Trade                        | Members can trade within imperial policy      | Emperor imposes bilateral and empire-wide embargoes                                     |
| External secondary sanctions | Local response per allowed member             | One binding empire-wide response                                                        |
| Intelligence                 | Shared in all cases                           | Shared in all cases                                                                     |

An emperor may change these policies at any time, with authoritative atomic conversion of affected state.

## Finances and construction

Imperial revenue decree options: zero transfer, a fixed amount, percentage, all income, or a specified class of revenue (e.g. maritime or rail). Under total centralization, members may be unable to build from personal treasury; emperor can still pay for infrastructure in their territories.

The Imperial Nation may authorize all building types, only certain types (e.g. cities and warships), or none for members. It can directly add, upgrade and delete their structures if permitted by engine/gameplay rules. Deduct true costs from the responsible treasury; no funds duplication, negative loops, or phantom refunds.

Trade restrictions can target outsider-to-whole-empire, outsider-to-specific-member, and member-to-member relationships. External secondary sanctions affecting members may be delegated or centralized, but the emperor can override any member's trade decision. Demands from outsiders to embargo one imperial member against another default to rejection unless the emperor orders otherwise.

## Three troop modes

**Fully centralized:** Every constituent contributes its active troops to one imperial army, with a unified cap equal to the sum of member caps. The Imperial Nation is the sole military commander. Existing campaigns, troop ownership and combat bookkeeping need an explicit atomic conversion. No troops created or destroyed by toggling.

**Hybrid:** Members retain their individual army; after a configured threshold (initial illustration: 60% of individual capacity), further generated troops are routed into a separate Imperial Army **only if imperial capacity exists**. Threshold is adjustable by unilateral decree. The emperor may move actual troops among members as policy permits.

**Decentralized:** Each state has its own army and cap. External war permission, national military control, levy rules, and defense are still subject to imperial law.

On full centralization -> decentralization, distribute currently pooled active troops **proportionally to the constituent nations' troop capacities**, respecting caps and exact troop conservation. Define deterministic rounding and treatment of attacks already in flight. The emperor may transfer actual troops between member armies without creating troops.

## National war versus imperial war

A member may fight a _national war_ while the rest of the empire remains at peace. The emperor controls which national actions are permitted. An _empire-wide war_ binds every member, and **only the emperor** can settle it.

An empire-wide war layered over an existing national war does not overwrite it. When the emperor ends the imperial war, a prior member's individual national war **remains active**.

Attacks on one imperial member may, per standing imperial policy, cause: no automatic intervention; a targeted defense levy; an empire-wide war declaration; or both. Foreign powers may separately choose to declare broader war against the empire in retaliation for member-specific aggression.

The emperor's own nation may be in a national war while the empire is collectively at peace. The reverse is impossible: an empire-wide war puts all its members at war. See [05-war-and-peace.md](05-war-and-peace.md).

## Coercive accession

The Imperial Nation can send an **Imperial Ultimatum** demanding submission with declared consequences (embargo, secondary sanctions, national war, empire-wide war, or invasion). The recipient evaluates whether the emperor can _actually_ execute them: distance, fleet and transport capabilities, border access, defense, alliances, costs, and imperial survival prospects. Refusal does not magically annex it. Threat follow-through affects reputation.

## Leadership transfer and the Ungovernable

Imperial Transfer: emperor may unilaterally nominate one surviving member as the new Imperial Nation; it gains the complete imperial treasury, external war authority, construction/army policy and executive powers, while the old emperor becomes a subordinate member. Empire identity and all wars survive.

**The Ungovernable:** if the Imperial Nation is the **strict unique lowest** among surviving empire members in all eight simultaneously — land, maximum population, active population, cities, factories, ports, silos, warships — issue an unmistakable 10-second in-game warning. The emperor must transfer leadership during that window or the empire dissolves. Ties do not count as strict lowest. Use prominent animation without unsafe strobing.

Elimination of the Imperial Nation without a valid prior transfer likewise dissolves the empire. Define the exact transition order for deaths/transfers so no ownerless empire can exist.

## Dissolution and assets

When the emperor **voluntarily dissolves** the empire, the imperial treasury is transferred to the former Imperial Nation. On involuntary collapse, if the former emperor survives its own nation it receives the imperial treasury; otherwise **distribute equally among surviving former members**. Each surviving member regains sovereignty and keeps its territory and personally owned structures. The pooled army is redistributed by capacities with no troop creation; imperial decrees end.

## Imperial victory

If the final surviving sovereign is an empire, its Imperial Nation is **Imperial Victor** (equal prestige to independent Sovereign Victor). Every surviving member is an **Empire Victor** (legitimate but lesser-prestige win). An empire cannot hold multiple external coalitions to game this status.
