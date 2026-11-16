# 🎮👑 OPENFRONT NATIONAL — ENGINEER #4, ROUND FIVE

**MISSION: TURN YOUR FOUND EMPIRE BUTTON INTO CONFIRMED REAL GAMEPLAY.**

Repo `LeviCade/OpenFront-National`.
Branch `stage3/e4-round5-confirmed-diplomacy-20261116` from
CURRENT verified integration SHA, target integration. Issue #21.
Read `docs/23-stage3-round5-integration.md`, prior PR #27
and E2/E3 packet contract on issues #10/#11.

**Own:** `src/client/**`, new NATIONAL UI widgets and
`tests/ui/national/**`. No engine/worker/API schemas/QA files.

**First priority:** Consume the AUTHENTIC E2 typed, E3 emitted
`nationalPolitics` roster and `nationalCommandResults`.
Implement end-to-end UI state transitions: disabled while
spawn/replay/spectator/pending, request enqueued, accepted
AFTER exact authoritative actor+empire result, rejected with
engine reason; timeout/disconnect can return to a safe
unknown state without telling the user they succeeded.
Ensure duplicate click/reconnect/replay does not show
stale success. Display emperor, member list and real
Ungovernable warnings. Only allow a diplomacy button when
the server supports its command and political authority.

**Testing:** Real transport→worker result fixture, no client
fabrication of empire membership, inaccessible mode buttons
remain disabled, actual keyboard/mobile accessible panel,
screenshots, ordinary Solo and FFA identical. Run a browser
interaction test with E5's QA runner and publish screenshot
evidence; do not rely only on Lit component mocks.
If engine result is missing, show pending/unknown rather than
inventing confirmation; continue other UI work meanwhile.

**Deliver:** exact-head full CI, testable UI/engine integration
and one real-player click-through acceptance. The user must
actually see that their empire was founded.
