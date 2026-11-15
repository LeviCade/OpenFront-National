# 05 — Formal war, negotiated peace, and layered imperial conflict

## State model

**CORE RULE:** The default diplomatic condition between two independent sovereign powers is **peace**. Offensive military action against another political power requires a **formal declaration of war**. Peacetime trade may still be blocked by embargo. No piracy without a currently applicable war.

War is a **record with scope and parties**, not one global boolean or opaque hostility score. A declaration identifies who initiated it, who is legally belligerent, the conflict's scope, and the authority under which it occurred. A legal war does not automatically force an independent country to participate merely because it belongs to an MDA.

## Two concurrent layers

**National war:** between specific nations, including an imperial constituent member and an external nation. A member may declare and negotiate such a war only when permitted by its Imperial Nation's policy. Emperor retains superior ability to declare/settle a member's national war.

**Empire-wide war:** between an empire as sovereign entity and an external sovereign opponent (independent nation or another empire). **Every constituent nation participates immediately**, including the Imperial Nation. Only the Imperial Nation may declare, negotiate, or end the empire-wide war on its own side. A foreign sovereign can declare war against the empire, subject to the normal universal declaration procedure.

**CORE RULE:** Effective war between any two nations is true if any applicable national war OR empire-wide war record remains active. An empire-wide peace cannot erase underlying national wars.

Example:

1. Member B of Empire E declares national war on independent X. B↔X at war; E's other members at peace.
2. Imperial Nation of E declares empire-wide war on X. All E members↔X at war.
3. Emperor negotiates empire-wide peace with X. **B↔X remains at war**, because B's separate original war record has not ended.
4. B negotiates its own peace if delegated, or emperor does so on B's behalf. Only then do all B↔X hostilities end.

The Imperial Nation itself may hold an individual national war while the empire as a whole is at peace. Reverse is impossible: if empire-wide war exists, all members are at war.

## Delegated member diplomacy

The Imperial Nation always retains ultimate sovereignty. Configurable policy:

- Member may declare national wars freely / only with approval / never.
- Member may propose and accept national peace freely / with approval / never.
- Intervention after hostile attack on member: none / automatic defensive levy / automatic empire-wide war / both.

These are independent choices. Delegated member diplomacy is not separate sovereignty; the emperor can revoke authority or act directly. Individual members cannot settle an empire-wide war regardless of delegation.

A member-specific war can exist without automatically preventing other imperial members from trading the enemy. Emperor may separately impose global or bilateral embargoes.

## Formal declaration and peace motion

- Player-facing action: select another nation or sovereign empire and **Declare War** (with precise scope).
- If the attacker shares any NAP/MDA with intended target, applicable **Betray** is required before the prohibited attack. No instant attack while still treaty-protected.
- Empire members may never declare internal wars against fellow constituents.
- Peace is a **motion from one side and acceptance by the other**. It cannot be unilaterally imposed by one belligerent. Nonresponse is not acceptance. Pending peace motions do not stop active combat.
- Declaring war automatically blocks trade between the belligerents while the war is active; separately issued peacetime embargoes persist after peace if not lifted.
- Declaration gives _permission_ for military action; it doesn't automatically send troops.
- Where multiple war records apply, the peace UI must show which specific scope will end and which conflicts would remain.

## Actions already underway at peace

**CORE RULE:** Preserve the intended existing-style behavior:

- Active **land invasion** halts hostility; surviving attacking troops return.
- **Naval transport/landing** already launched continues its voyage. On arrival it may capture **one initial landing pixel/tile** and must return the rest of the surviving invading force. It cannot continue inland conquest during peace.
- **Missile already airborne** continues and resolves even if peace is accepted before impact. Newly ordered strikes require war.
- Newly initiated land attacks, transports directed as invasions, new missiles, and piracy against the now-peaceful target are blocked.
- Any separately existing war layer continues to authorize hostilities; ending an empire-wide war does not interrupt an active national war between the same parties.

Explicitly reserve attacks/missile launches ordered _after_ the effective peace tick as illegal. The implementation needs deterministic event ordering and no exploit allowing post-peace free land beyond the single already-committed naval landing tile. A peacetime nuclear impact from a previously launched missile is a committed-in-flight exception, not a license for further attacks.

## Empire admission, transfer, and war

- Nation joins empire while at war: its **existing national wars remain**, and standing accession/response policies decide whether the rest of the empire automatically intervenes.
- Emperor voluntarily transfers leadership: all existing empire-wide war records remain attached to the same empire identity. National wars remain with their nation parties.
- Empire dissolution: any empire-wide war obligations must have a deterministic transition policy into post-dissolution relations. **OPEN:** exact inheritance/termination of imperial war when empire disappears, without erasing extant member-specific wars.
- Defensive troop interception is _not_ a declaration of offensive war by each contributing ally; see [03-coalitions.md](03-coalitions.md).

## Invariants

No two conflicting sources of truth for war status. No negative or duplicated troops on declaration/peace. A peace motion's acceptance has an exact deterministic tick. An outside power cannot end a national war on behalf of an empire member without authorized acceptance. Human and AI use identical actions and info.

## Acceptance

Test independent war declaration, blocked peacetime attack, treaty betrayal prerequisite, member-specific war without universal escalation, empire-wide overlay and removal with underlying national war surviving, imperial transfer, peace during in-flight missile/naval/land attack, and member delegation changes midwar.
