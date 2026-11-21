// @vitest-environment jsdom
import { GameType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, describe, expect, it } from "vitest";
import "../../../src/client/NationalDiplomacyPanel";
import type { NationalDiplomacyPanel } from "../../../src/client/NationalDiplomacyPanel";
import type { LobbyConfig } from "../../../src/client/ClientGameRunner";
import { Transport } from "../../../src/client/Transport";
import {
  acceptTrustedNationalPrivateCapability,
  hasTrustedNationalPrivateCapability,
  type NationalPrivateCapabilityContext,
  type TrustedNationalStartLike,
} from "../../../src/client/NationalPrivateCapability";
import type { GameView } from "../../../src/client/view";
import type { WireGameStartInfo } from "@openfront/shared/WireSchemas";

const elements: HTMLElement[] = [];
afterEach(() => {
  for (const element of elements.splice(0)) element.remove();
});

function session() {
  const bus = new EventBus();
  const start = {
    gameID: "class5-real-private",
    config: { gameType: GameType.Private, nationalMode: true },
    players: [{ clientID: "real-a" }, { clientID: "real-b" }],
  } as WireGameStartInfo;
  const packet: TrustedNationalStartLike = {
    type: "national_start",
    gameStartInfo: start,
    myClientID: "real-a",
    tick: 15,
  };
  const context: NationalPrivateCapabilityContext = {
    gameID: start.gameID,
    start,
    startClientID: "real-a",
    remoteSocketOpen: true,
    sessionReady: true,
    replay: false,
    spectator: false,
  };
  return { bus, start, packet, context };
}

describe("Class Five E4 real Private NATIONAL human controls", () => {
  it("renders only a read-only status with no commands for legacy unapproved Private", async () => {
    const { bus, start } = session();
    const panel = document.createElement("national-diplomacy-panel") as NationalDiplomacyPanel;
    panel.eventBus = bus;
    panel.game = {
      gameID: () => start.gameID,
      config: () => ({
        gameConfig: () => ({ gameType: GameType.Private, nationalMode: true }),
        isReplay: () => false,
      }),
      isSpectator: () => false,
    } as unknown as GameView;
    document.body.append(panel);
    elements.push(panel);
    await panel.updateComplete;
    expect(panel.querySelector('[data-national-private-capability="blocked"]')).not.toBeNull();
    expect(panel.querySelector("button")).toBeNull();
    expect(panel.querySelector("form")).toBeNull();
    expect(panel.textContent).toContain("server verifies");
    expect(hasTrustedNationalPrivateCapability(bus, start.gameID)).toBe(false);
  });

  it("Transport refuses Private commands until the exact E2 trusted start, not a room flag", () => {
    const { bus, start, packet, context } = session();
    const transport = Object.create(Transport.prototype) as Transport;
    Object.assign(transport, {
      lobbyConfig: {
        gameID: start.gameID,
        gameStartInfo: start,
        spectator: false,
      } as LobbyConfig,
      eventBus: bus,
      isLocal: false,
      isSessionReady: true,
      socket: { readyState: WebSocket.OPEN },
    });
    const allowed = () =>
      (transport as unknown as { nationalDiplomacyWireEnabled: () => boolean })
        .nationalDiplomacyWireEnabled();
    expect(allowed()).toBe(false);
    expect(acceptTrustedNationalPrivateCapability(bus, packet, context)).toBe(true);
    expect(allowed()).toBe(true);
    Object.assign(transport, { isSessionReady: false });
    expect(allowed()).toBe(false);
    Object.assign(transport, { isSessionReady: true, lobbyConfig: { gameID: start.gameID, gameStartInfo: start, spectator: true } });
    expect(allowed()).toBe(false);
    Object.assign(transport, { lobbyConfig: { gameID: "other-game", gameStartInfo: start, spectator: false } });
    expect(allowed()).toBe(false);
  });
});
