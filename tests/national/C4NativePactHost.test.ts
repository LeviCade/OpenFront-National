/** Actual authenticated host -> real engine -> Zbin recipient frames.
 * Canonical read port lives in E1; assert its full visibility when integrated.
 * Before merge, still execute the real seven command receipts and assert fail-closed absence.
 */
import {
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import type { GameConfig } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import type { NationalObserverMapV1 } from "@openfront/engine/national/observation/NationalObserverMap";
import {
  decodeServerMessage,
  encodeServerMessage,
} from "@openfront/shared/ZbinWire";
import { describe, expect, it } from "vitest";
import { NationalObserverMapContinuity } from "../../src/client/NationalObserverMapContinuity";
import type { PactAction } from "../../src/client/NationalPactState";
import { parseTrustedNationalProjection } from "../../src/client/TrustedNationalSession";
import { Client } from "../../src/server/Client";
import {
  encodeNationalRecipientProjection,
  MAX_NATIONAL_PROJECTION_BYTES,
} from "../../src/server/national/NationalRecipientWire";
import { TrustedNationalMatch } from "../../src/server/national/TrustedNationalMatch";
import { setup } from "../util/Setup";
import { TestConfig } from "../util/TestConfig";

const A = new PlayerInfo("North", PlayerType.Human, "C2E3CLIA", "C2NATIONA");
const B = new PlayerInfo("South", PlayerType.Human, "C2E3CLIB", "C2NATIONB");
const C = new PlayerInfo("West", PlayerType.Human, "C2E3CLIC", "C2NATIONC");
const P = [A, B, C];
const MATCH = "c4-e4-real-pact-host";

class TrustedHostConfig extends TestConfig {
  constructor(config: GameConfig, replay: boolean) {
    super(config, replay, false, false, true);
  }
}
interface Socket {
  readyState: number;
  frames: Uint8Array[];
  send(bytes: Uint8Array): void;
}
function seat(p: PlayerInfo): { client: Client; socket: Socket } {
  const socket: Socket = {
    readyState: 1,
    frames: [],
    send(bytes) {
      this.frames.push(bytes);
    },
  };
  return {
    socket,
    client: new Client(
      p.clientID!,
      "persistent-" + p.id,
      {} as NonNullable<Client["claims"]>,
      null,
      undefined,
      "127.0.0.1",
      p.name,
      null,
      socket as unknown as Client["ws"],
      undefined,
      "verified-" + p.id,
      [],
    ),
  };
}
function view(socket: Socket) {
  const bytes = socket.frames[socket.frames.length - 1];
  expect(bytes).toBeDefined();
  const msg = decodeServerMessage(bytes, undefined);
  expect(msg.type).toBe("national_projection");
  if (msg.type !== "national_projection") throw new Error("wrong frame");
  expect(msg.payload.length).toBeLessThanOrEqual(MAX_NATIONAL_PROJECTION_BYTES);
  expect(msg.payload).not.toMatch(
    /GameSnapshot|canonicalTurn|secretTreaty|credentials|landingDestination/,
  );
  const data = JSON.parse(msg.payload) as GameUpdateViewData & {
    nationalObserverMap?: NationalObserverMapV1;
  };
  expect(data.tick).toBe(msg.tick);
  return { msg, data, map: data.nationalObserverMap! };
}
async function rig(mapName: string, starts: number[]) {
  const game = await setup(
    mapName,
    { nationalMode: true, gameType: GameType.Private, gameMode: GameMode.FFA },
    P,
    undefined,
    TrustedHostConfig,
  );
  for (let i = 0; i < P.length; i++) {
    game.addExecution(new SpawnExecution(MATCH, P[i], starts[i]));
  }
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  for (const p of P) expect(game.player(p.id).hasSpawned()).toBe(true);
  const runner = new GameRunner(
    game,
    new Executor(game, MATCH, undefined),
    () => {},
    undefined,
  );
  const sockets = P.map(seat);
  const measurements = { wireMs: 0 };
  const host = new TrustedNationalMatch(
    MATCH,
    runner,
    sockets.map((s) => s.client),
    (client, packet) => {
      const target = sockets.find((s) => s.client === client);
      if (!target) throw new Error("unrecognized host seat");
      const wireStarted = performance.now();
      const payload = encodeNationalRecipientProjection(packet);
      // E2's real GameServer emits on Client.ws AFTER an original-seat
      // reconnect. Do not pin this test delivery to the first socket object.
      (client.ws as unknown as Socket).send(
        encodeServerMessage(
          {
            type: "national_projection",
            tick: packet.tick,
            payload,
          },
          undefined,
        ),
      );
      measurements.wireMs += performance.now() - wireStarted;
    },
  );
  return { game, sockets, host, measurements };
}
function tickTwice(host: TrustedNationalMatch) {
  host.tick();
  host.tick();
}

describe("C4 E4 stamped pact commands on actual server-owned engine and recipient wire", () => {
  it("executes all seven commands, detects real rejection, and observes constitutional revocation on the integrated port", async () => {
    const initial = await setup("plains", { nationalMode: true }, P);
    const { game, host, sockets } = await rig("plains", [
      initial.ref(15, 20),
      initial.ref(45, 35),
      initial.ref(70, 50),
    ]);
    const pactId = "c4_pact";
    let count = 0;
    const read = (i: number) => view(sockets[i].socket).data;
    const command = (
      seatIndex: number,
      action: PactAction,
      accepted = true,
    ) => {
      const requestId = "np_" + (++count).toString(16).padStart(32, "0");
      expect(
        host.submit(sockets[seatIndex].client, { ...action, requestId }),
      ).toBe(true);
      tickTwice(host);
      const rows = read(seatIndex).nationalCommandResults ?? [];
      expect(rows).toContainEqual(
        expect.objectContaining({
          type: action.type,
          requestId,
          actorId: P[seatIndex].id,
          recipientId: P[seatIndex].id,
          commandTargetId: pactId,
          accepted,
        }),
      );
      for (const i of [0, 1, 2].filter((i) => i !== seatIndex))
        expect(
          read(i).nationalCommandResults?.some(
            (r) => r.requestId === requestId,
          ) ?? false,
        ).toBe(false);
    };
    const terms = { admission: "leader", expulsion: "leader" } as const;
    command(0, {
      type: "national_found_pact",
      pactId,
      name: "North Sea",
      pactKind: "NAP",
      terms,
    });
    const canonical =
      typeof (game as unknown as { nationalPactDisclosure?: unknown })
        .nationalPactDisclosure === "function";
    // The E1 port is mandatory on the integrated acceptance branch; standalone E4 lacks it.
    if (process.env.NATIONAL_C4_REQUIRE_PACT_READ === "1")
      expect(canonical).toBe(true);
    const detail = (i: number) =>
      read(i).nationalPactDisclosure?.pacts.find((p) => p.pactId === pactId);
    const roster = () =>
      read(0).nationalPolitics?.pacts?.find((p) => p.id === pactId);
    const expectNoTerms = (i: number) => {
      expect(detail(i)).toBeUndefined();
      expect(JSON.stringify(read(i).nationalPolitics)).not.toMatch(
        /"terms"|"pendingAmendment"|"approvedBy"|"invitations"/,
      );
    };
    if (canonical) {
      expect(roster()).toMatchObject({
        id: pactId,
        name: "North Sea",
        kind: "NAP",
        memberIds: [A.id],
        administratorId: A.id,
      });
      expect(detail(0)).toMatchObject({ relationship: "member", terms });
    } else {
      expect(read(0).nationalPactDisclosure).toBeUndefined();
      expect(read(0).nationalPolitics?.pacts).toBeUndefined();
    }
    expectNoTerms(1);
    expectNoTerms(2);
    command(2, { type: "national_accept_pact", pactId }, false);
    command(0, { type: "national_invite_pact", pactId, candidateId: B.id });
    if (canonical)
      expect(detail(1)).toMatchObject({ relationship: "invited", terms });
    expectNoTerms(2);
    command(1, { type: "national_accept_pact", pactId });
    if (canonical) expect(detail(1)?.relationship).toBe("member");
    const next = { admission: "leader", expulsion: "leader" } as const;
    // Change administrator to B to demonstrate the post-amendment command authority.
    command(0, {
      type: "national_propose_pact_amendment",
      pactId,
      terms: next,
      administratorId: B.id,
    });
    if (canonical)
      expect(detail(1)?.pendingAmendment).toMatchObject({
        terms: next,
        administratorId: B.id,
        approvedBy: [A.id],
      });
    expectNoTerms(2);
    command(1, { type: "national_approve_pact_amendment", pactId });
    if (canonical) {
      expect(roster()?.administratorId).toBe(B.id);
      expect(detail(0)?.pendingAmendment).toBeUndefined();
    }
    command(1, { type: "national_invite_pact", pactId, candidateId: C.id });
    if (canonical) expect(detail(2)?.relationship).toBe("invited");
    command(2, { type: "national_accept_pact", pactId });
    if (canonical) expect(detail(2)?.relationship).toBe("member");
    command(2, { type: "national_betray_pact", pactId });
    expectNoTerms(2);
    command(0, { type: "national_expel_pact", pactId, memberId: B.id }, false);
    command(1, { type: "national_expel_pact", pactId, memberId: A.id });
    expectNoTerms(0);
    if (canonical) {
      expect(read(0).nationalPolitics).toEqual(read(1).nationalPolitics);
      const current = view(sockets[1].socket);
      const packet = parseTrustedNationalProjection(
        current.msg.payload,
        current.msg.tick,
      );
      expect(() =>
        new NationalObserverMapContinuity(
          B.id,
          "former-epoch",
        ).acceptProjection(packet),
      ).toThrow();
      expect(read(1).nationalPactDisclosure?.streamId).toBe(
        current.map.streamId,
      );
      expect(read(1).nationalPactDisclosure?.tick).toBe(current.data.tick);
    }
  });
});
