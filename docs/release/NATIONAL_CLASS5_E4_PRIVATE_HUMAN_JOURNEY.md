# Class Five E4 — Authentic Private NATIONAL human acceptance contract

**Founding SHA:** `fc6ad9c7b3c142aae0c454d532cd929c13aa8a0f`. **Owner:** E4. **Official completion:** 40%. This is the production client gate and source-level acceptance contract, **not** a released Private NATIONAL match, browser acceptance or physical GPU certificate.

## E2 handshake: strict server authority

The new append-only zbin `national_capability` server message is version 1, with `gameID`, `clientID` and `active`. E2 may send `active:true` **only** for an authenticated live socket, admitted human seat and trusted-server-owned GameRunner in the same unranked Private NATIONAL match. The message must originate from E2's authenticated game socket, never a room option, guest-provided field, client event, recording, mirror Solo session or any previous match.

E2 must **not** advertise an active capability until canonical turns/state remain server-only and E3's recipient-filtered GameUpdateViewData is delivered to the authenticated seat, with no raw turns, snapshots or private Game state reaching browsers. E2 remains the final authenticated command validator and actor-ID stamper. E4 matches capability to current websocket admission, exact server `start` gameID/clientID and roster, Private+NATIONAL config, current connection and non-replay/non-spectator. Reconnect/close/leave/server revocation invalidates it and drops buffered NATIONAL intents; legacy protocol leaves Private controls blocked.

**E5 selector before capability:** `[data-national-private-capability="blocked"]` renders a noninteractive status (no command buttons). **After verified capability:** `national-diplomacy-panel button[aria-controls="national-diplomacy-content"]` and existing action selectors. 390×844 pre-spawn panel remains collapsed and input overlay unobstructed. Do not fabricate a server capability in the browser harness.

## Real three-human A/B/C acceptance

| Human journey | Real action | Required authoritative result |
| --- | --- | --- |
| A/B/C open match | Three separate authenticated active socket seats admitted before start | Same gameID, distinct stamped clientIDs, trusted hosted runner, seat-scoped capability, no hidden state exposure |
| A spawns and founds | Unobstructed map touch; `#national-empire-id` and Found Empire | Match's exact `nf_` request ID, E2-stamped A, E1 accepted founding receipt and fresh public roster showing A leader/member; no 00:00 HUD inference |
| A offers B | `#national-accession-candidate` -> `#national-offer-accession` | A's `np_` accepted command receipt; B sees genuine recipient-private invitation, not A |
| B requests A | `#national-request-empire` -> `#national-request-accession` | B's own authenticated candidate target and request receipt, no membership until A accepts |
| Recipient accepts | B or A uses `#national-invitation-empire` -> `#national-accept-accession` | Actual receiving authenticated principal sends command, target stays offered candidate; exact accepted E1 receipt plus new candidate in fresh roster |
| A transfers crown | `#national-crown-successor` -> `#national-transfer-crown` | Accepted E1 receipt, fresh leader B; A immediately loses emperor-only controls |
| C declares WAR and attacks | `#national-war-target`, `#national-declare-war`, `[data-national-map-target-id]`, native radial Attack | Real E1 war receipt, actual enemy-owned tile via screen→world transform, real troop order, resulting authoritative troops/ownership change |
| Opposing principal makes peace | `#national-peace-war-id` and other authenticated principal's `#national-peace-motion-id` | Fresh recipient-only motion and E1 accepted peace receipt, conflict endedTick; no self-acceptance |
| Leave/reconnect/replay/spectate | Lose original seat or start different match | E4 blocks commands and invalidates pending status until server authenticates a fresh eligible seat |

E5 owns genuine separate browser/CDP evidence and E6 independent physical GPU/host witness. E2 owns trusted Private lobby transport and E3 private projections. E4's code does not bypass E2's existing Private prohibition.
