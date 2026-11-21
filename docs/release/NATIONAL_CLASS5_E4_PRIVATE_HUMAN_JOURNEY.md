# Class Five E4 — Trusted NATIONAL Private human journey

**Founding source:** `fc6ad9c7b3c142aae0c454d532cd929c13aa8a0f`. **E2-native wire reviewed:** `8fcb3d5e39f40f769abb5e3fd79f36748e9d3101`. **Official completion:** 40%. **This is an E4 production UI/transport gate and source-level acceptance contract; it is not a release certificate or a successful two-browser test.**

## One protocol — E2 national_start and recipient-only national_projection

E2's trusted-server wire already defines `national_start {gameStartInfo, myClientID, tick}` and bounded `national_projection {tick, payload}`. E4 **does not** invent a second `national_capability` wire variant or enable legacy Private. E4 consumes E2's genuine `national_start` decoded from the active authenticated websocket, validates its real gameID, server-assigned clientID present in the start roster, NATIONAL Private config, current socket, non-replay and non-spectator. Only then does the browser reveal NATIONAL political controls. A legacy `start` or lobby room flag cannot grant access. The E4 status selector before admission is `[data-national-private-capability="blocked"]` with no command buttons. Socket close/reconnect/leave/spectate revokes approval, discards buffered NATIONAL commands and invalidates claims.

**Security precondition:** E2 must never emit `national_start` until the real admitted server-only GameRunner is active, emitting E3 recipient-filtered `national_projection` to each authorized principal. No raw turns, snapshots, hidden opponent resources or browser-owned authoritative GameRunner. Every command is still server-stamped and enforced by E1/E2; this client gate is not the security boundary.

E2's current `ClientGameRunner` emits `TrustedNationalStartedEvent` and `TrustedNationalProjectionEvent` and deliberately **does not mount the legacy browser GameRunner**. Therefore E4's `national-diplomacy-panel` must ultimately receive an E2/E3-compatible read-only current match view and a rendered map surface. Without that separate view/renderer integration, the server transport source may pass while **real human gameplay is still BLOCKED**. Do not substitute a fake `GameView` or two Solo tabs. E4's existing Solo actions and map controller remain unchanged.

## A/B/C action-by-action physical browser contract

| Step | Human input | Actual observed E1/E2/E3 evidence |
| --- | --- | --- |
| A/B/C join | Three separate authenticated accounts join one unlisted Private FFA lobby as active humans before host start | Same server gameID, three distinct stamped clientIDs, trusted-host-only runner and individually filtered projections; no canonical turns in browsers |
| A spawns | 390×844 unobstructed real touch on `#game-input-overlay`; desktop real mouse for 1280×800 | A owns a real land tile, `!inSpawnPhase()`; NATIONAL header was collapsed pre-spawn; screenshot and tick proof |
| A founds | `#national-empire-id` and actual Found Empire submit | One `nf_[0-9a-f]{32}` ID, server-stamped A, E1 accepted receipt with sequence and tick, *fresh* public roster naming A leader/member; do not infer from 00:00 HUD or EventBus |
| A invites B | `#national-accession-candidate` then `#national-offer-accession` | A's exact accepted `np_` offer receipt; B sees own E3 private invitation; A never sees B's packet |
| B requests A | `#national-request-empire` then `#national-request-accession` | B's own candidate ID preserved; accepted command does not mean membership; E3 private candidate→emperor invitation appears only for A |
| Receiver accepts | B or A selects `#national-invitation-empire` then `#national-accept-accession` | Receiving real authenticated principal's accepted E1 receipt, actual offered candidate as target and candidate newly present in current memberIds after receipt tick |
| A crowns B | `#national-crown-successor` then `#national-transfer-crown` | Matching E1 accepted receipt and fresh roster with leader B; A's emperor-only actions vanish |
| C attacks | C chooses `#national-war-target`, `#national-declare-war`, then visible `[data-national-map-target-id]` marker | E1 accepted WAR receipt + new layer; pointer screen-to-world maps to actual enemy-owned tile, native radial menu center Attack sends real troops and E2 authoritative troop/territory consequence |
| Opponent makes peace | One opposing principal proposes `#national-peace-war-id`, other accepts `#national-peace-motion-id` | Recipient-only motion, opponent's authenticated accepted receipt and current ended conflict; proposer never self-accepts |
| Replay, disconnect, rejoin, spectator | Interruption or seat change | Immediate Private command disabled state, no stale receipt success; only fresh authenticated `national_start` can reauthorize |

**Coordination:** E2 owns secure lobby/ingress, server runner and actual `national_start`/projection flow; E3 private DTO projection; E5 independent browser/CDP actions; E6 signed physical GPU witness. E4 owns the production client gate, disabled state, existing political controls and exact selectors. The Conductor must integrate all layers and evaluate the real match before credit.
