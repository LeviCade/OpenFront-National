# 10 — NATIONAL scenario acceptance matrix

These are **required behavioral tests**, not claims of implemented behavior. Assign each a deterministic seed and assert the state before/after each tick. Verify replay equivalence, authorization and troop/gold conservation wherever applicable.

## SOV — sovereignty and victory

- **SOV-01 Last island:** Independent island owns one tile; empire owns 99% of map. No victory until island is eliminated or joins empire.
- **SOV-02 Treaty isn't sovereign:** Only two nations survive, both members of same MDA. No victory.
- **SOV-03 Empire last standing:** Entire surviving world consists of Imperial Nation and seven members, all inside one empire. Imperial Victor = leader, Empire Victor = seven members.
- **SOV-04 Leadership transfer at end:** Empire transfers crown to a member before world victory. New crown-holder gets Imperial Victor; former emperor gets Empire Victor.
- **SOV-05 Ungovernable strict:** Imperial Nation strictly last on all eight metrics. Ten-second transfer-or-dissolve warning. One tie or higher value prevents triggering.
- **SOV-06 Elimination:** Imperial Nation eliminated without successful transfer. Empire dissolves, formerly subordinate survivors regain sovereign status, victory reassessed.
- **SOV-07 Unclaimed map:** Last independent nation remains while unowned territory exists; it wins.

## COAL — constitutional politics

- **COAL-01 Multi-membership:** Independent state belongs to two NAPs and an MDA at once.
- **COAL-02 Hidden rules:** Outsider sees coalition name/type/members but not terms; invited party sees terms before accepting.
- **COAL-03 Governance separation:** Leader unilaterally admits; unanimity required to amend; compliant members cannot be expelled when constitution forbids discretionary expulsion.
- **COAL-04 Betrayal overrides protection:** Member clicks Betray and is immediately expelled, even from a pact forbidding discretionary expulsions.
- **COAL-05 Prohibited assault:** Member attempts to attack another NAP member without first betraying. Block or explicitly complete betrayal first, never attack while retaining treaty.
- **COAL-06 Empire accession:** Accepted entrant is removed from every outside coalition in one valid state transition.
- **COAL-07 Unanimity:** One member rejects amendment; existing constitution remains unchanged.

## LEVY — instant automatic defense

- **LEVY-01 Fifty-thousand push:** A sends 50K at B; MDA contributor(s) provide 45K immediately; only 5K proceeds toward B before normal territory combat.
- **LEVY-02 Full shield:** Valid incoming 30K can be fully intercepted before any tile loss.
- **LEVY-03 No charge on invalid attack:** Unlawful, canceled or rejected attack removes zero levy troops.
- **LEVY-04 Repeated microattacks:** Twenty attack clicks belonging to one invasion/campaign cannot generate twenty separate full levy allowances.
- **LEVY-05 Two alliances same tick:** Nation C in two MDAs supports two conflicts simultaneously without spending a troop twice; pro-rata or stable deterministic allocation.
- **LEVY-06 Minimum reserve:** Do not levy a contributor below protected troop reserve even if treaty member urgently needs help.
- **LEVY-07 No donation cap hack:** Defence ledger does not create or clone army above ordinary troop/cap rules.

## WAR — layered formal war and peace

- **WAR-01 Default peace:** Attempt at peacetime offensive land attack is invalid; declaring war first enables legal initiation.
- **WAR-02 National scoped:** B in Empire E at war with X; other E members remain at peace and may trade with X.
- **WAR-03 Imperial overlay:** Emperor declares empire-wide war against X; E's all members become belligerents.
- **WAR-04 Independent peace:** Emperor ends empire-wide war with X; B's earlier national war with X survives; other members return to peace.
- **WAR-05 Delegated peace:** B may accept peace on its own national war only when emperor's policy allows.
- **WAR-06 Centralized imperial peace:** B cannot negotiate an empire-wide peace under any delegated national permission.
- **WAR-07 National emperor war:** Imperial Nation individually at war with X but empire at peace; allowed. Empire war with X with leader at peace; impossible.
- **WAR-08 Admission while at war:** Nation C enters empire while at war with X. Its national war survives; standing imperial response policy determines wider escalation.
- **WAR-09 Overlapping peace:** Existing land attacks stop and surviving troops return on peace acceptance, except where another active war layer still authorizes hostility.
- **WAR-10 Midair missile:** Missile validly launched before peace hits afterwards; new post-peace missile launch is refused.
- **WAR-11 Naval transport:** Transport launched before peace sails, captures at most first landing tile, returns remaining force.
- **WAR-12 Empire transfer in war:** Active imperial and national war records survive leadership change with lawful new negotiator.

## ECON — sanctions, embargo, coercion

- **ECON-01 Peacetime embargo:** Nation A embargoes peaceful B; no trade but attacking B's trade ship remains prohibited.
- **ECON-02 Secondary sanctions accepted:** A threatens trade-cutoff if C trades B; C complies, preserving A's trade and losing B's trade by actual policy choice.
- **ECON-03 Secondary sanctions defied:** C keeps trading B; A must enforce embargo against C or back down; no forced switch on C.
- **ECON-04 Imperial sanctions:** Only emperor can impose full-empire secondary sanction; member requires approval to issue empire-binding demand.
- **ECON-05 Limited imperial response:** Different member states can respond differently to outside sanction under delegated policy, subject to emperor override.
- **ECON-06 Coercion bluff:** Distant empire with insufficient amphibious capability threatens island; independent AI may refuse, not submit based only on land share.
- **ECON-07 Credible submission:** Besieged nation with genuinely failed survival alternatives may accept imperial ultimatum if emperor likely to protect/survive.
- **ECON-08 Proxy state piracy:** Member H at war with X may pirate X while other empire members remain peace/trade; outsiders may broaden their own retaliation.

## NAV — blockade and shipping

- **NAV-01 Enemy piracy:** Wartime enemy trade vessel meeting authorized blockader can be captured.
- **NAV-02 Neutral turned home:** Neutral trade ship approaching legally blockaded enemy port is turned to nearest eligible home port without capture and generates zero revenue on return.
- **NAV-03 No phantom blockade:** Warships too far from eligible zone or at peace cannot trigger blockade return.
- **NAV-04 Blockade broken:** Destroy/remove warships or end war; new neutral ships are not turned back.
- **NAV-05 No retrigger loop:** Ship returning after neutral interception isn't repeatedly reset by unrelated blockade detection.

## FOG — visibility and secret information

- **FOG-01 Public facts:** Name, land%, public wars and membership visible globally.
- **FOG-02 Hidden terms:** Coalition constitution unavailable to outsiders both in UI and underlying client data.
- **FOG-03 Border sight:** Neighbor sees structures within initial 100-tile strip, not all unseen structures.
- **FOG-04 Coast/ship sight:** Ship within initial 200-tile observer radius visible; disappears when outside.
- **FOG-05 Transport secrecy:** Landing target hidden unless independently visible from a legitimate mechanism.
- **FOG-06 Shared empire intelligence:** Member A's legitimate observation immediately benefits member B, without granting outsiders access.
- **FOG-07 AI parity:** With identical observation permissions, AI cannot read hidden positions via separate engine API.

## AI — national interest

- **AI-01 Human-neutral:** Identical observed geopolitical situations with human-vs-AI target do not alter preferences based on controller type.
- **AI-02 Faraway superpower:** AI continues rational local campaign rather than abandoning it solely because land leader crossed threshold elsewhere.
- **AI-03 Self-preserving MDA:** Nation predicts personal retaliation and may refuse unfavorable entry despite collective advantage.
- **AI-04 Tiny nation with plan:** Weak nation with credible independent survival path does not automatically submit to empire.
- **AI-05 Declining empire:** Endangered nation does not seek refuge with likely collapsing overlord solely for a member win.
- **AI-06 All-in member:** Member state continues actively optimizing empire victory after accession.
- **AI-07 Credibility:** Known serial bluffer's ultimatum receives less weight than equivalent threat from reliable enforcer, all else equal.

## Technical gate

Every transition has assertions for no double troop spending, no free gold, no stale invalid war authorization, no hidden-info leak, and identical replay output. Legacy Solo and multiplayer modes remain green.
