# 07 — Fog of war, information, and national intelligence

## Principle

**CORE RULE:** By default, nations know surprisingly little about distant rivals. NATIONAL is a game of incomplete information. Human and AI see **the same legitimate information** for their political position; national planners use observational data, not hidden engine state.

## Public-by-default information

Everyone may know a nation's name, public land percentage, coalition memberships, formally declared wars and official sovereign status. Public coalition names, types, leaders and member rosters are visible; **actual constitutions, levy terms, admission/expulsion powers, and imperial policies are hidden** from outsiders.

The user's earlier suggested public "credit rating" is reserved for the **deferred credit/economic update**; no active credit market or ratings in initial NATIONAL.

Hidden by default: detailed troop count, treasury, economic figures, structure positions, warship/transport/trade ship positions except observed, and transport landing destination. Diplomatic offers reveal necessary terms to recipient before acceptance.

## Geographic line of sight

**RECOMMENDED INITIAL DISTANCES** (subject to map-scale and performance validation):
- Shared land border: see structures within **100 tiles** inside the neighboring nation along that frontier.
- Own coast: observe foreign vessels within **200 tiles** of the national coastline.
- Own warship: observe foreign vessels within **200 tiles** of that ship.
- Imperial membership: aggregate all qualifying owned/observed geographic information from every member.
- Ships outside all eligible observation regions remain invisible and their destination/landing target is not exposed simply because they exist.

Formal logic must define tile-distance metric, occlusion, map boundaries, shoreline geometry, ship entry/exit snapshots, and whether visible ships retain a last-seen marker after leaving coverage. Distances are examples, not shipping/navigation physics.

## Treaty and imperial information

NAP/MDA members receive substantial **member statistics** (e.g. economy and troop levels as permitted by the treaty-info schema) but not automatic full structure coordinates. Exact stats available to each ordinary treaty tier are a tuning item.

An empire **shares everything it legitimately knows** across all constituent states, including observed map areas, detected ships, purchased intelligence and intelligence reports. This sharing is independent of whether its army is fully centralized, hybrid or decentralized.

Outside players may inspect coalition roster but not enforcement clauses. A pending valid invitation or offered membership reveals the entire constitution to its recipient before assent.

## Intelligence investment tiers

The precise economy/pricing is still to be designed using existing gold:

1. **Regional reconnaissance:** time-limited exposure of structures and military activity in selected geographic area.
2. **National assessment:** meaningful but possibly estimated detail of target nation's economy, forces and military posture.
3. **Global/satellite reconnaissance:** very expensive, temporary, far-reaching map visibility. It should provide actual defined observations, not omniscient access to every private secret by default.

Intelligence must have real opportunity cost and a meaningful duration. Reconnaissance should not force another nation to disclose a constitution without membership. Whether specific covert treaty discovery is allowed is **OPEN**; initial default: no.

**Lender collateral visibility and its 200-tile surroundings** were discussed, but sovereign credit is **DEFERRED**, so this is a future integration hook, not a NATIONAL v1 feature.

## Technical trust boundaries

Do not load all hidden information onto a player's client and merely hide it in UI. Enforce visibility on the authoritative game-data boundary or equivalent proven safe access pattern. AI observation must obey the same rules.

Maintain deterministic and efficiently computed visibility unions. Update observation sources on territory changes, coast detection changes, fleet movements, intelligence activation/expiry, and empire accession/dissolution. Favor region-based incremental updates over scanning every object for every nation on every tick.

## Intelligence and national interest

A powerful empire may be bluffing: its land share is public, but its navy is unseen. Another nation must estimate whether that empire can enforce an invasion ultimatum. A tiny state with strong reconnaissance may see a weakness others miss. NATIONAL AI can use hypotheses, historic observations and reliability estimates, but may not silently read the answer.

## Acceptance

- Distant enemy structure is absent from both player client payload and AI observation.
- Border neighbor reveals structures within prescribed strip, not the full country.
- Enemy ship becomes visible within warship/coastal radius and disappears when coverage ends.
- Transport destination remains hidden unless legitimately inferred/revealed by a future explicitly defined feature.
- Empire shares member-derived intelligence immediately and loses inappropriate sharing when dissolved.
- Pending invite reveals constitution only to recipient, not the public.
- AI and human with same observations cannot obtain different hidden information through interfaces.
