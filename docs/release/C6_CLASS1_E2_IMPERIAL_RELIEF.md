# Sixth Class One — E2 imperial emergency relief

Issue: #187. Sixth common foundation: 1e8da462d357cf839af2cad448fa027e40735d36.
Exact Fifth revenue head: 5f89b9e82b5ebba61bee37a6d99f2d6e6e88c3ec (PR #179).
Inherited by **true two-parent merge** 3f89d404f00375d3ea00e7d15cfdaccbb93440bc
with both original Git histories preserved. Fifth revenue contribution code is **NOT** Sixth-original work.

## Sixth original authority contract

Only a real, living **non-emperor** empire member may request a positive integer
gold amount from 1 to 999,999,999,999. A relief ID is globally unique per
NATIONAL match, ASCII safe, 1–64 characters, and never reused. The ledger
fails closed after 4096 requests. Every request begins pending at version 0.

The current living emperor alone may approve or reject the matching
empire / request ID / expectedVersion 0. The requesting member cannot
approve their own request even if they inherit the crown. A decision produces
version 1; duplicates, stale decisions, forged principals and foreign empires
are rejected. Insufficient treasury leaves the request pending, without a debit.

Approval preflights the actual, living PlayerImpl recipient, matching
empire membership, and the existing administration row treasury.
PlayerImpl.prepareNationalGoldCredits stages the **real wallet credit**
WITHOUT counting it as new income. The same existing treasury is debited
by precisely that amount. The operation creates **no gold**:

    treasury_before + wallet_before = treasury_after + wallet_after

The wallet then pays for lawful normal Game construction, unlike separately
treasury-funded imperial construction. Source-contribution counters and
preexisting sanctions, WAR, troop pools and piracy/trade permissions do not change.

On empire dissolution or member elimination/removal, pending requests become
cancelled, preserving IDs and outcomes to forbid posthumous replay.
Approved, rejected and cancelled records remain in the bounded ledger.

## Privacy, persistence and migration

An emperor receives pending and historical requests from their empire,
while another living constituent receives only **their own**. The server
projects a recipient- and tick-bound imperial policy packet; the strict
decoder refuses forged foreign requests. Outsiders and legacy FFA receive none.

The original NationalRuntime V1 treasury and policy row remain intact.
The new optional reliefRequests field is omitted in older V1 saved games and
defaults to an empty ledger. Version, status, decision identity and amounts
survive authoritative snapshot, deterministic state hash and GameSnapshot
round-trip. Existing binary command variants retain original order: new
request-relief and decide-relief cases append to the administration union.

## Reproducible evidence

Dedicated live tests: tests/national/C6Class1ImperialRelief.test.ts.
Inherited revenue regression: tests/national/C5Class3ImperialRevenue.test.ts.

The positive scenario exercises a real PlayerExecution worker payout
with 100% contribution, requests and approves a treasury transfer, asserts
conserved exact bigint balances, then verifies that the now-funded member
can afford and actually builds a City through normal Player.buildUnit.

Negative controls: actual GameRunner stamped request/approval, stale
emperor and crown changes, self approval, insufficient treasury, crossed
empire, replayed IDs/versions, bad amounts, rejected request, FFA, private
wire spoofing, V1 migration, tampered duplicated snapshot, binary round-trip
and dissolution. The Fifth historical suite exercises the actual maritime,
rail and captured-piracy payout hooks.

## Shared-file collision and Conductor handoff

| Source                    | E2 insertion                                                                               | Combined owner                             |
| ------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------ |
| NationalRuntime.ts        | bounded relief ledger, request and decision, cancellation and restore; Fifth income routes | E3 charter/sanction authority              |
| Schemas.ts                | **append** two administration command variants                                             | E3 sanction settlement and other appends   |
| GameImpl.ts               | two administration cases, member request journal replay                                    | E3 trade sanctions and E4 v6 Game snapshot |
| NationalImperialView.ts   | private optional reliefRequests DTO                                                        | E1 native imperial panel                   |
| NationalPactProjection.ts | member/emperor-only relief projection                                                      | E1 native member display                   |
| Game.ts                   | no new method; existing command union                                                      | Conductor shared interface                 |
| Game snapshots            | optional NationalRuntime V1 field only                                                     | E4 GameSnapshot v6                         |

Do not resolve conflicts by replacing complete shared files. Integrate by
named symbols, re-run tests, and retain E3's delegated sanctions and E4's
assessment versioning. No self-merge, main update or deployment.
