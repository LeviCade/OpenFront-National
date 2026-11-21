// @vitest-environment jsdom
import { GameType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import type { WireGameStartInfo } from "@openfront/shared/WireSchemas";
import { describe, expect, it } from "vitest";
import {
  acceptTrustedNationalPrivateCapability,
  eligibleTrustedNationalPrivateSeat,
  hasTrustedNationalPrivateCapability,
  NationalPrivateCapabilityChangedEvent,
  revokeTrustedNationalPrivateCapability,
  type NationalPrivateCapabilityContext,
} from "../../../src/client/NationalPrivateCapability";

const packet = {
  type: "national_capability",
  version: 1,
  gameID: "actual-private-match",
  clientID: "seat-a",
  active: true,
} as const;

function context(): NationalPrivateCapabilityContext {
  return {
    gameID: packet.gameID,
    start: {
      gameID: packet.gameID,
      config: { gameType: GameType.Private, nationalMode: true },
      players: [{ clientID: "seat-a" }, { clientID: "seat-b" }],
    } as WireGameStartInfo,
    startClientID: packet.clientID,
    remoteSocketOpen: true,
    sessionReady: true,
    replay: false,
    spectator: false,
  };
}

describe("Class Five E4 trusted NATIONAL Private gate", () => {
  it("requires exact server-approved remote start, seat, match and live state", () => {
    expect(eligibleTrustedNationalPrivateSeat(context(), packet)).toBe(true);
    const wrong: NationalPrivateCapabilityContext[] = [
      { ...context(), gameID: "other-game" },
      { ...context(), startClientID: "seat-b" },
      { ...context(), startClientID: null },
      { ...context(), start: null },
      { ...context(), remoteSocketOpen: false },
      { ...context(), sessionReady: false },
      { ...context(), replay: true },
      { ...context(), spectator: true },
      {
        ...context(),
        start: {
          ...context().start!,
          config: { gameType: GameType.Private, nationalMode: false },
        } as WireGameStartInfo,
      },
      {
        ...context(),
        start: {
          ...context().start!,
          config: { gameType: GameType.Singleplayer, nationalMode: true },
        } as WireGameStartInfo,
      },
      {
        ...context(),
        start: {
          ...context().start!,
          players: [{ clientID: "seat-b" }],
        } as WireGameStartInfo,
      },
    ];
    for (const invalid of wrong) {
      expect(eligibleTrustedNationalPrivateSeat(invalid, packet)).toBe(false);
    }
    expect(eligibleTrustedNationalPrivateSeat(context(), { ...packet, gameID: "wrong" })).toBe(false);
    expect(eligibleTrustedNationalPrivateSeat(context(), { ...packet, active: false })).toBe(false);
  });

  it("a room flag or event alone never grants commands; explicit revocation clears the match", () => {
    const bus = new EventBus();
    const seen: boolean[] = [];
    bus.on(NationalPrivateCapabilityChangedEvent, (event) => seen.push(event.ready));
    expect(hasTrustedNationalPrivateCapability(bus, packet.gameID)).toBe(false);
    bus.emit(new NationalPrivateCapabilityChangedEvent(packet.gameID, true));
    expect(hasTrustedNationalPrivateCapability(bus, packet.gameID)).toBe(false);
    expect(acceptTrustedNationalPrivateCapability(bus, packet, context())).toBe(true);
    expect(hasTrustedNationalPrivateCapability(bus, packet.gameID)).toBe(true);
    expect(hasTrustedNationalPrivateCapability(bus, "another-match")).toBe(false);
    expect(acceptTrustedNationalPrivateCapability(bus, { ...packet, active: false }, context())).toBe(false);
    expect(hasTrustedNationalPrivateCapability(bus, packet.gameID)).toBe(false);
    expect(acceptTrustedNationalPrivateCapability(bus, packet, context())).toBe(true);
    revokeTrustedNationalPrivateCapability(bus, packet.gameID);
    expect(hasTrustedNationalPrivateCapability(bus, packet.gameID)).toBe(false);
    expect(seen).toEqual([true, true, false, true, false]);
  });

  it("a previous game's capability never authorizes a different match", () => {
    const bus = new EventBus();
    expect(acceptTrustedNationalPrivateCapability(bus, packet, context())).toBe(true);
    expect(hasTrustedNationalPrivateCapability(bus, "new-game")).toBe(false);
    expect(acceptTrustedNationalPrivateCapability(bus, { ...packet, gameID: "new-game" }, context())).toBe(false);
    expect(hasTrustedNationalPrivateCapability(bus, packet.gameID)).toBe(false);
  });
});
