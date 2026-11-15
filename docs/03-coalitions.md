# 03 — Pacts, defense alliances, and constitutional governance

## The three-system framework

**CORE RULE:** NATIONAL replaces ordinary standalone Ally/Betray relations with formal **Non-Aggression Pacts (NAP)**, **Mutual Defense Alliances (MDA)** and **Empires**. The detailed empire rules are in [04-empires.md](04-empires.md).

Independent nations may create and join multiple NAPs and MDAs. An empire member, **including the Imperial Nation**, may not join or form any outside coalition. Empire entry terminates other coalition membership by the specified accession transition.

## Coalition constitution

Each NAP or MDA is a stateful agreement with public name, type, member roster and leader/administrator identity (where applicable). The actual constitution is *secret from nonmembers* until an invitation or offer is pending; members see it in full.

Configurable separate constitutional powers:
- Admission: unilateral named administrator, leader, selected approvers, simple majority, supermajority or unanimous vote.
- Expulsion of **compliant** members: unilateral administrator, vote thresholds, or forbidden.
- Amendments to the standing constitution: **unanimous agreement** of all current members (CORE RULE).
- Membership limits: leader-governed vs collective governance; number of possible signatories, deadlines.
- Retaliation for breach: penalties, sanctions, voluntary collective response, mandatory defense/wartime response where compatible with war rules.
- MDA defense levy: maximum percentage and protected reserve; contribution policy defined in treaty.
- Admission and expulsion authority are independent. A pact can have unanimous admission and prohibit discretionary expulsion.

**Terminology:** bilateral means *two parties*. "One nation decides admissions/expulsions" is **leader-governed**, not bilateral. Multilateral refers to multiple parties. Do not conflate size and governance.

## Sovereign exit and betrayal

**CORE RULE:** Every independent member of a NAP/MDA has an absolute and immediate right to leave. Doing so is a formal **Betray** action and causes **automatic, nonwaivable expulsion**. No coalition may require perpetual membership.

A nation attempting prohibited offensive aggression against a fellow coalition member must first **Betray** the applicable coalition. The engine does not allow a secret treaty-violating attack to proceed while pretending membership remains intact. Auto-betray/expel can be atomic with the attack if explicitly confirmed. Betrayal consequences (relations, sanctions, retaliation) run from recorded treaty rules.

A constitution may prohibit **discretionary** expulsion of compliant members, but never expulsion on actual betrayal. An empire cannot be betrayed or left unilaterally.

## Non-Aggression Pacts

NAP members agree not to attack each other without first betraying the pact. They need not defend other members, share armies, join wars, or stop external expansion. Enforcement beyond membership loss depends on treaty terms.

A NAP is not a merged sovereign, a victory team, or a guarantee that a member won't independently start war with an outsider.

## Mutual Defense Alliances: instantaneous levy

**CORE RULE:** A valid incoming hostile attack on an eligible member triggers automatic defensive troop commitments *at execution time and before any territory is conquered*. The treaty is the decision to commit; do not ask allies for real-time permission on every attack.

Example: A attacks B with 50K, and B's MDA ally C contributes 45K before territorial combat. With one-for-one defensive interception, only 5K of attacking force remains to proceed. If eligible contributions fully intercept, no land is lost to that push.

Recommended initial policy: each eligible ally contributes no more than **10% of its actual available troops per qualifying campaign**, and cannot be levied below **30% of its troop capacity**. These are suggested tuning values, not universally fixed final numbers.

Allocate required interception by weighted eligible strength, capped per nation; take **only enough** to meet the incoming force. Never create troops, charge contributors twice, or push a recipient above its cap via regular donation. Use an explicit intercept-reserve or equivalent ledger. Unused surviving troops must be accounted for and returned according to combat semantics.

The triggering instant is the moment a **valid attack actually begins**, not a button press or canceled/invalid attack. Multiple small attacks and simultaneous invasions must aggregate under a defensible campaign budget to prevent levy-spam exploits. Combat between already-in-flight attacks, boats, and peace transitions needs an explicit engine ordering contract.

## Overlapping memberships

Independent nations may join multiple NAPs/MDAs **even when that creates strategically unwise conflicting commitments**. Automatic defensive levies may fund defense against a nation in a separate coalition; that is the consequence of joining multiple treaties.

However:
- Mandatory defensive contributions are not themselves a conscious offensive betrayal.
- Troops cannot be double-levied across multiple treaties at the same timestamp.
- An independent nation must still betray a pact before conducting its *own* prohibited attack on a co-member.
- Deterministic ordering and pro-rata allocation for simultaneous demands are mandatory.
- A defensive levy does not, by itself, declare a war for the contributing nation; it is scoped defensive support.

## Coalition discovery and secrecy

Public: names, types, members, known administrators, active membership status. Hidden: exact rules, vote thresholds, levies, sanctions, amendment clauses, and imperial policies. A nation receiving a valid offer or pending invitation can review the constitution *before consenting*.

Do not leak hidden treaty data in client payloads or AI state. Coalition secrecy is a gameplay rule, not merely UI hiding.

## Acceptance

- Multiple ordinary memberships work.
- A "no discretionary expulsion" NAP still expels traitors.
- Constitution amendment fails with a single rejecting member.
- A member cannot attack a NAP co-signatory while preserving membership.
- An actual 50K invasion triggers levy before land loss, using actual committed troops.
- Twenty micro-attacks cannot claim twenty fresh full levy budgets against the same campaign.
- Empire admission makes all outside memberships invalid in one atomic transition.
