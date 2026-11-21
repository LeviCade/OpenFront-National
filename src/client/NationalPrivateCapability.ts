import { GameType } from "@openfront/engine-api/game/GameTypes";
import type { EventBus, GameEvent } from "@openfront/shared/EventBus";
import type {
  ServerNationalCapabilityMessage,
  WireGameStartInfo,
} from "@openfront/shared/WireSchemas";

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
  packet: ServerNationalCapabilityMessage,
): boolean {
  return (
    packet.version === 1 &&
    packet.active === true &&
    context.remoteSocketOpen &&
    context.sessionReady &&
    !context.replay &&
    !context.spectator &&
    context.start?.gameID === context.gameID &&
    packet.gameID === context.gameID &&
    context.start.config.gameType === GameType.Private &&
    context.start.config.nationalMode === true &&
    context.startClientID !== null &&
    packet.clientID === context.startClientID &&
    context.start.players.some((player) => player.clientID === packet.clientID)
  );
}

/**
 * Invoked by Transport only after decoding a frame from its own authenticated
 * websocket. No room setting or arbitrary event-bus broadcast calls this.
 */
export function acceptTrustedNationalPrivateCapability(
  bus: EventBus,
  packet: ServerNationalCapabilityMessage,
  context: NationalPrivateCapabilityContext,
): boolean {
  const ready = eligibleTrustedNationalPrivateSeat(context, packet);
  if (!ready) {
    revokeTrustedNationalPrivateCapability(bus, context.gameID);
    return false;
  }
  accepted.set(bus, { gameID: packet.gameID, clientID: packet.clientID });
  bus.emit(new NationalPrivateCapabilityChangedEvent(packet.gameID, true));
  return true;
}

export function revokeTrustedNationalPrivateCapability(
  bus: EventBus,
  gameID: string,
): void {
  const previous = accepted.get(bus);
  accepted.delete(bus);
  bus.emit(
    new NationalPrivateCapabilityChangedEvent(previous?.gameID ?? gameID, false),
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
