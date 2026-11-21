import { GameType } from "@openfront/engine-api/game/GameTypes";
import type { EventBus, GameEvent } from "@openfront/shared/EventBus";
import type { WireGameStartInfo } from "@openfront/shared/WireSchemas";

/** E2's native trusted start message, not an E4-created wire variant. */
export interface TrustedNationalStartLike {
  readonly type: "national_start";
  readonly gameStartInfo: WireGameStartInfo;
  readonly myClientID: string;
  readonly tick: number;
}

/**
 * Connection-scoped UI permission granted only by the actual decoded server
 * frame. This never replaces E2's server-side intent authentication.
 */
interface AcceptedSeat {
  readonly gameID: string;
  readonly clientID: string;
}
const accepted = new WeakMap<EventBus, AcceptedSeat>();

export class NationalPrivateCapabilityChangedEvent implements GameEvent {
  constructor(
    public readonly gameID: string,
    public readonly ready: boolean,
  ) {}
}

export interface NationalPrivateCapabilityContext {
  readonly gameID: string;
  readonly start: WireGameStartInfo | null;
  readonly startClientID: string | null;
  readonly remoteSocketOpen: boolean;
  readonly sessionReady: boolean;
  readonly replay: boolean;
  readonly spectator: boolean;
}

/** No legacy Private, bogus client actor, replay or stale start may pass. */
export function eligibleTrustedNationalPrivateSeat(
  context: NationalPrivateCapabilityContext,
  packet: TrustedNationalStartLike,
): boolean {
  return (
    packet.type === "national_start" &&
    Number.isSafeInteger(packet.tick) &&
    packet.tick >= 0 &&
    context.remoteSocketOpen &&
    context.sessionReady &&
    !context.replay &&
    !context.spectator &&
    context.start?.gameID === context.gameID &&
    packet.gameStartInfo.gameID === context.gameID &&
    packet.gameStartInfo.config.gameType === GameType.Private &&
    packet.gameStartInfo.config.nationalMode === true &&
    context.start.config.gameType === GameType.Private &&
    context.start.config.nationalMode === true &&
    context.startClientID !== null &&
    packet.myClientID === context.startClientID &&
    context.start.players.some(
      (player) => player.clientID === packet.myClientID,
    ) &&
    packet.gameStartInfo.players.some(
      (player) => player.clientID === packet.myClientID,
    )
  );
}

/**
 * Invoked by Transport only after decoding E2 national_start from its own authenticated
 * websocket. No room setting or arbitrary event-bus broadcast calls this.
 */
export function acceptTrustedNationalPrivateCapability(
  bus: EventBus,
  packet: TrustedNationalStartLike,
  context: NationalPrivateCapabilityContext,
): boolean {
  const ready = eligibleTrustedNationalPrivateSeat(context, packet);
  if (!ready) {
    revokeTrustedNationalPrivateCapability(bus, context.gameID);
    return false;
  }
  accepted.set(bus, { gameID: context.gameID, clientID: packet.myClientID });
  bus.emit(new NationalPrivateCapabilityChangedEvent(context.gameID, true));
  return true;
}

export function revokeTrustedNationalPrivateCapability(
  bus: EventBus,
  gameID: string,
): void {
  const previous = accepted.get(bus);
  accepted.delete(bus);
  bus.emit(
    new NationalPrivateCapabilityChangedEvent(
      previous?.gameID ?? gameID,
      false,
    ),
  );
}

/** Read-only UI gate: exact event bus and current gameID, never a room flag. */
export function hasTrustedNationalPrivateCapability(
  bus: EventBus | null,
  gameID: string,
): boolean {
  const seat = bus ? accepted.get(bus) : null;
  return seat?.gameID === gameID;
}
