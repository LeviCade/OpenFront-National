# C7C1 E1 extended coalition constitution

Implementation contract (issue #216; not a certification).

- Membership cap is optional, inclusive of founder/administrator, 2–256. Without it the inherited rules apply. An amendment below the current roster is rejected, never silently expels. A successful consent rotates the constitutional epoch; in simultaneous final-slot competition authoritative execution order decides the winner, later stale consents fail.
- Invitation duration is optional, 1–36,000 simulation ticks (100 ms per tick). The clock is not wall time. A proposal's deadline is fixed when created; later ballots do not renew it. The invitation expires at the boundary, including any partial approvals. Expiry and applicant withdrawal rotate the epoch and retain unrelated valid ballots; old commands cannot apply to renewed invitations.
- Admission and expulsion have independent rules and independent selected approver lists. For extended constitutions expulsion is a vote from one authenticated member. The proposed target is excluded from all expulsion electorates, including selected and unanimous. Administrator policy has only the current administrator as eligible voter, unless that is the target. Strict majority = floor(n/2)+1 (ties fail), supermajority = ceil(2n/3), selected/unanimous = all eligible; zero eligible cannot authorize. Five _eligible_ voters (six signatories including the target) require three/four votes respectively. Duplicate, stale and nonmember votes reject. Roster/policy changes invalidate all ballots; leaving selected approvers is not replaced by implicit delegation.
- The extended marker is permanent for a pact lifetime. Old unversioned expulsion commands cannot bypass an extended constitution. A unanimous amendment can remove cap/deadline but cannot remove versioned command authority. Existing unextended legacy pact terms and their historical two-member unanimous-expulsion behavior are preserved.
- Amendments still require every current member, including any member targeted by an expulsion vote. A versioned amendment can be rejected by any member and must be reproposed with a new monotonic proposal ID. The historical field name defenseVersion/expectedDefenseVersion is reused for this proposal identity, even for constitutional-only extended terms.
- Immediate Betray remains unconditional and does not cast a vote. Empire entry uses existing exclusive-membership removal and invalidates affected ballots. No penalties, wars, troop deductions or levy accounting changes are added.
- Native zbin: four v2 variants appended after existing variants; existing intent layouts and discriminant order are not edited. Founding/amendment V2 carries new optional terms; v2 expulsion requires the epoch; v2 rejection requires the proposal ID. Existing admission/accept intents carry their established epoch. The Game-owned journal maps v2 operations to their existing political command kinds and receipts. Snapshot additions are optional tagged record fields; no root registry changes.
- Public roster is unchanged. Exact extended clauses and expiry are only in the recipient-bound private constitution view; pending expulsion ballots only members, invitation deadline only the invited candidate or members. Existing pending admission secrecy remains in force.
- Source validation is not a release or completion claim. Run the engineer workflow and integrated regression gates on the exact submitted head.

### Exact accepted-request replay

Extended pacts privately retain the invitation epoch that admitted each current
member. An exact historical accepted admission receipt remains idempotent only
while that same admission still grants membership. Departure removes the proof;
joining a recreated pact allocates a new epoch. Neither the proof nor the private
request journal appears in public or recipient treaty projections.
