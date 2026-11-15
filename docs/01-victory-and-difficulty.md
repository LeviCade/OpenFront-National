# 01 — NATIONAL difficulty, political identity, and victory

## Status and scope

**CORE RULE:** Introduce **NATIONAL** above Impossible as an opt-in Solo Free-for-All experience with new geopolitical rules and upgraded strategic AI. Do not quietly modify legacy difficulties or multiplayer rules. An eventual extension to other modes requires separate design.

Visual identity: an extraordinary gold crown-and-shield emblem, clearly higher than Impossible, with accurate and accessible labeling. Artwork is not yet committed.

## Sovereign victory

Replace land-percentage-based victory for NATIONAL with the **last surviving sovereign power** rule:

- If exactly one surviving independent nation exists and no empire exists, that nation wins a **Sovereign Victory**.
- If exactly one surviving empire exists and no independent nations or other empires exist, that empire wins an **Imperial Victory**.
- Other sovereign powers must actually be eliminated or voluntarily incorporated. An independent island with a single surviving tile is still a contender.
- Unclaimed land is not a sovereign political actor and does not prevent victory.
- A Non-Aggression Pact or Mutual Defense Alliance is **not** a sovereign state. Two nations allied by treaty still count as two sovereign contenders.
- A dissolved empire produces surviving independent sovereign contenders again.
- Timer, overtime, score, territory threshold, disconnection, surrender, and human-only-win shortcuts must be audited so none silently defeats the last-sovereign requirement. Explicit timeout/disconnect policy is **OPEN**.

## Victory prestige

| Position at resolution | Result | Prestige |
| --- | --- | --- |
| Last independent sovereign nation | **Sovereign Victor** | Highest |
| Imperial Nation leading the last surviving empire | **Imperial Victor** | Highest — equal to sovereign victory |
| Surviving constituent member of victorious empire | **Empire Victor** | Legitimate win, lower prestige |

Each surviving imperial member is a winner, but **not** the supreme winner. This avoids requiring puppet-state cannibalization and makes empire submission potentially rational. It should not make instant empire submission optimal.

## Nation behavior before and after submission

For an independent nation, **supreme victory** is the strategic preference. Relative size disadvantage or unfavorable simulated odds alone do not justify sacrificing independence. Serious consideration of accession should require deteriorating viable options, an imminent and credible existential threat, low chances of recovering independently, and an empire likely to survive and prevail. A threatened nation may defy a bluff. A collapsing empire should not be an attractive refuge.

**After accession**, the member's goal becomes protecting and winning for the empire, with maximal effort. Member states must not self-sabotage, idle, or seek the emperor's defeat to improve an individual victory label; unilateral secession is unavailable.

## No fake difficulty

NATIONAL AI:
- Receives no economic boosts, troop multipliers, free intel, combat bonuses, or human player targeting.
- Uses the same authoritative game rules, visibility, and action constraints as a human.
- Differs in planning, optimization, risk assessment, strategy memory, coalition choice, and diplomatic judgment.

## Illustrative required cases

1. 90% land empire versus tiny independent island: **no victory** until island loses sovereignty.
2. Seven states in one empire and zero outsiders: empire wins, supreme status assigned only to Imperial Nation.
3. Three nations in mutual defense pact and no outsiders: **no victory**.
4. Empire transfers imperial status moments before winning: **new** Imperial Nation is the Imperial Victor.
5. A small nation with a robust survival plan rejects accession even if its current land share is minuscule.

All outcomes must be deterministic across save/load and replay.
