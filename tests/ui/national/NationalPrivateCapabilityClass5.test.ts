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
  type TrustedNationalStartLike,
} from "../../../src/client/NationalPrivateCapability";

const startInfo = {
  gameID: "actual-private-match",
  config: { gameType: GameType.Private, nationalMode: true },
  players: [{ clientID: "seat-a" }, { clientID: "seat-b" }],
} as WireGameStartInfo;
const packet: TrustedNationalStartLike = {
  type: "national_start",
  gameStartInfo: startInfo,
  myClientID: "seat-a",
  tick: 12,
};
function context(): NationalPrivateCapabilityContext {
  return {
    gameID: startInfo.gameID,
    start: startInfo,
    startClientID: "seat-a",
    remoteSocketOpen: true,
    sessionReady: true,
    replay: false,
    spectator: false,
  };
}

describe("Class Five E4 native E2 national_start gate", () => {
  it("admits only the exact authenticated active Private NATIONAL match and seat", () => {
    expect(eligibleTrustedNationalPrivateSeat(context(), packet)).toBe(true);
    const wrong: NationalPrivateCapabilityContext[] = [
      { ...context(), gameID: "other" },
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
          ...startInfo,
          config: { gameType: GameType.Singleplayer, nationalMode: true },
        } as WireGameStartInfo,
      },
      {
        ...context(),
        start: { ...startInfo, players: [{ clientID: "seat-b" }] } as WireGameStartInfo,
      },
    ];
    for (const invalid of wrong)
      expect(eligibleTrustedNationalPrivateSeat(invalid, packet)).toBe(false);
    expect(eligibleTrustedNationalPrivateSeat(context(), { ...packet, tick: -1 })).toBe(false);
    expect(eligibleTrustedNationalPrivateSeat(context(), { ...packet, myClientID: "seat-c" })).toBe(false);
    expect(eligibleTrustedNationalPrivateSeat(context(), { ...packet, type: "start" } as unknown as TrustedNationalStartLike)).toBe(false);
    expect(eligibleTrustedNationalPrivateSeat(context(), { ...packet, gameStartInfo: { ...startInfo, gameID: "other" } })).toBe(false);
    expect(eligibleTrustedNationalPrivateSeat(context(), { ...packet, gameStartInfo: { ...startInfo, config: { gameType: GameType.Private, nationalMode: false } } as WireGameStartInfo })).toBe(false);
  });

  it("cannot approve from arbitrary event bus status or legacy Private flag", () => {
    const bus = new EventBus();
    const events: boolean[] = [];
    bus.on(NationalPrivateCapabilityChangedEvent, (event) => events.push(event.ready));
    expect(hasTrustedNationalPrivateCapability(bus, context().gameID)).toBe(false);
    bus.emit(new NationalPrivateCapabilityChangedEvent(context().gameID, true));
    expect(hasTrustedNationalPrivateCapability(bus, context().gameID)).toBe(false);
    expect(acceptTrustedNationalPrivateCapability(bus, packet, context())).toBe(true);
    expect(hasTrustedNationalPrivateCapability(bus, context().gameID)).toBe(true);
    expect(hasTrustedNationalPrivateCapability(bus, "another-game")).toBe(false);
    revokeTrustedNationalPrivateCapability(bus, context().gameID);
    expect(hasTrustedNationalPrivateCapability(bus, context().gameID)).toBe(false);
    expect(acceptTrustedNationalPrivateCapability(bus, packet, { ...context(), replay: true })).toBe(false);
    expect(events).toEqual([true, true, false, false]);
  });
});
