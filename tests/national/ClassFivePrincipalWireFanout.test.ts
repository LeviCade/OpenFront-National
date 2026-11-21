/**
 * E3 Class Five: genuine E2 server-owned GameRunner → E3 per-socket projector
 * → TrustedNationalMatch's authenticated outbound callback
 * → E4 production private invitation/receipt readers.
 *
 * Uses a real Game and real server-stamped execution. The socket fixture
 * models E2's admitted Client; E2's own transport tests prove actual Zbin
 * national_projection byte emission when both owners are assembled.
 * This does not substitute for E5's physical two-browser end-to-end run.
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
import { NationalServerRecipientSession } from "@openfront/engine/national/observation/NationalServerOutbound";
import { describe, expect, it } from "vitest";
import {
  readNationalAccessionOffers,
  readNationalPoliticalResults,
} from "../../src/client/NationalDiplomacyState";
import { Client } from "../../src/server/Client";
import { TrustedNationalMatch } from "../../src/server/national/TrustedNationalMatch";
import { setup } from "../util/Setup";
import { TestConfig } from "../util/TestConfig";

const A = new PlayerInfo("Emperor", PlayerType.Human, "C5CLIENTA", "C5NATIONA");
const B = new PlayerInfo("Invitee", PlayerType.Human, "C5CLIENTB", "C5NATIONB");
const C = new PlayerInfo("Foreign", PlayerType.Human, "C5CLIENTC", "C5NATIONC");
const D = new PlayerInfo(
  "Candidate",
  PlayerType.Human,
  "C5CLIENTD",
  "C5NATIOND",
);
const PEOPLE = [A, B, C, D];
const ID = "c5_real_empire";
const MATCH = "C5_TRUSTED_FANOUT";

class TrustedHostConfig extends TestConfig {
  constructor(config: GameConfig, replay: boolean) {
    super(config, replay, false, false, true);
  }
}

type TestSocket = {
  readyState: number;
  send(bytes: Uint8Array): void;
  readonly frames: Uint8Array[];
};
function admitted(p: PlayerInfo): { client: Client; socket: TestSocket } {
  const socket: TestSocket = {
    readyState: 1,
    frames: [],
    send(bytes) {
      this.frames.push(bytes);
    },
  };
  const client = new Client(
    p.clientID!,
    "separate-persistent-" + p.clientID,
    {} as NonNullable<Client["claims"]>,
    null,
    undefined,
    "127.0.0.1",
    p.name,
    null,
    socket as unknown as Client["ws"],
    undefined,
    "verified-independent-" + p.id,
    [],
  );
  return { client, socket };
}

async function realMatch() {
  const game = await setup(
    "plains",
    { nationalMode: true, gameType: GameType.Private, gameMode: GameMode.FFA },
    PEOPLE,
    undefined,
    TrustedHostConfig,
  );
  for (let i = 0; i < PEOPLE.length; i++) {
    const p = PEOPLE[i];
    game.addExecution(
      new SpawnExecution(MATCH, p, game.ref(15 + i * 20, 20 + i * 15)),
    );
  }
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  for (const p of PEOPLE) expect(game.player(p.id).hasSpawned()).toBe(true);
  const runner = new GameRunner(
    game,
    new Executor(game, MATCH, undefined),
    () => {},
    undefined,
  );
  const sockets = PEOPLE.map(admitted);
  const observed = new Map<Client, GameUpdateViewData[]>();
  for (const { client } of sockets) observed.set(client, []);
  const authority = new TrustedNationalMatch(
    MATCH,
    runner,
    sockets.map((s) => s.client),
    (client, packet) => observed.get(client)?.push(packet),
  );
  for (const s of sockets) sessionFrames.set(s.socket, observed.get(s.client)!);
  return { game, runner, authority, sockets, observed };
}

const sessionFrames = new WeakMap<TestSocket, GameUpdateViewData[]>();
function frames(s: TestSocket): GameUpdateViewData[] {
  return sessionFrames.get(s) ?? [];
}
function latest(s: TestSocket): GameUpdateViewData {
  const all = frames(s);
  expect(all.length).toBeGreaterThan(0);
  return all[all.length - 1];
}
function action(
  type:
    | "national_offer_empire"
    | "national_accept_empire"
    | "national_transfer_crown",
  who: string,
  suffix: string,
) {
  return {
    type,
    empireId: ID,
    requestId: "np_" + suffix.repeat(32),
    ...(type === "national_transfer_crown"
      ? { successorId: who }
      : { candidateId: who }),
  };
}
function twice(host: TrustedNationalMatch) {
  host.tick();
  host.tick();
}

describe("Class Five server-verified physical-socket recipient fanout", () => {
  it("uses ONE E3 per-socket projector for candidate→emperor and emperor→candidate authenticated delivery", async () => {
    const { authority, game, sockets, observed } = await realMatch();
    const [a, b, c, d] = sockets;
    expect(
      authority.submit(a.client, {
        type: "national_found_empire",
        empireId: ID,
        requestId: "found_class5_a",
        clientID: b.client.clientID, // malicious actor assertion gets stripped
      }),
    ).toBe(true);
    twice(authority);
    expect(game.nationalPoliticalAuthority()?.emperorOf(ID)).toBe(A.id);
    const publicA = latest(a.socket).nationalPolitics;
    const publicC = latest(c.socket).nationalPolitics;
    expect(publicA).toEqual(publicC);
    expect(publicA?.empires).toEqual([
      expect.objectContaining({ id: ID, leaderId: A.id }),
    ]);
    // Only emperor A may see A's founding receipt.
    expect(latest(a.socket).nationalCommandResults).toEqual([
      expect.objectContaining({
        actorId: A.id,
        recipientId: A.id,
        accepted: true,
      }),
    ]);
    expect(latest(b.socket).nationalCommandResults).toBeUndefined();
    expect(latest(c.socket).nationalCommandResults).toBeUndefined();

    // RECIPROCAL D→A: D remains the candidate; A is the recipient.
    expect(
      authority.submit(d.client, action("national_offer_empire", D.id, "1")),
    ).toBe(true);
    twice(authority);
    const offeredA = latest(a.socket);
    expect(offeredA.nationalAccessionOffers).toMatchObject({
      recipientId: A.id,
      offers: [
        {
          empireId: ID,
          candidateId: D.id,
          proposerId: D.id,
          recipientId: A.id,
        },
      ],
    });
    expect(
      readNationalAccessionOffers(offeredA.nationalAccessionOffers, A.id)
        ?.offers,
    ).toHaveLength(1);
    expect(
      readNationalAccessionOffers(offeredA.nationalAccessionOffers, C.id),
    ).toBeNull();
    expect(latest(b.socket).nationalAccessionOffers?.offers).toEqual([]);
    expect(latest(c.socket).nationalAccessionOffers?.offers).toEqual([]);
    expect(latest(d.socket).nationalCommandResults).toEqual([
      expect.objectContaining({
        type: "national_offer_empire",
        actorId: D.id,
        recipientId: D.id,
        accepted: true,
      }),
    ]);
    expect(offeredA.nationalCommandResults).toBeUndefined();

    // E2 queues the emperor's accepted intent. Receipt appears ONLY after E1.
    expect(
      authority.submit(a.client, action("national_accept_empire", D.id, "2")),
    ).toBe(true);
    authority.tick();
    expect(latest(a.socket).nationalAccessionOffers?.offers).toHaveLength(1);
    expect(latest(a.socket).nationalCommandResults).toBeUndefined();
    authority.tick();
    const consentA = latest(a.socket);
    const accepted = consentA.nationalCommandResults?.find(
      (r) => r.requestId === "np_" + "2".repeat(32),
    );
    expect(accepted).toMatchObject({
      actorId: A.id,
      recipientId: A.id,
      type: "national_accept_empire",
      commandTargetId: ID,
      accepted: true,
    });
    expect(
      readNationalPoliticalResults(consentA.nationalCommandResults, A.id),
    ).toHaveLength(1);
    expect(consentA.nationalAccessionOffers?.offers).toEqual([]);
    expect(game.nationalPoliticalAuthority()?.membersOf(ID)).toContain(D.id);
    expect(latest(c.socket).nationalCommandResults).toBeUndefined();

    // NORMAL A→B: candidate B receives A's offer; emperor A does not.
    expect(
      authority.submit(a.client, action("national_offer_empire", B.id, "3")),
    ).toBe(true);
    twice(authority);
    const offeredB = latest(b.socket);
    expect(offeredB.nationalAccessionOffers?.offers).toEqual([
      expect.objectContaining({
        candidateId: B.id,
        proposerId: A.id,
        recipientId: B.id,
      }),
    ]);
    expect(
      readNationalAccessionOffers(offeredB.nationalAccessionOffers, B.id)
        ?.offers,
    ).toHaveLength(1);
    expect(latest(a.socket).nationalAccessionOffers?.offers).toEqual([]);
    expect(latest(c.socket).nationalAccessionOffers?.offers).toEqual([]);
    expect(
      authority.submit(b.client, action("national_accept_empire", B.id, "4")),
    ).toBe(true);
    twice(authority);
    expect(game.nationalPoliticalAuthority()?.membersOf(ID)).toContain(B.id);
    expect(latest(b.socket).nationalAccessionOffers?.offers).toEqual([]);
    expect(latest(b.socket).nationalCommandResults).toEqual([
      expect.objectContaining({
        actorId: B.id,
        recipientId: B.id,
        type: "national_accept_empire",
        commandTargetId: ID,
        accepted: true,
      }),
    ]);
    expect(latest(d.socket).nationalCommandResults).toBeUndefined();
    expect(observed.get(a.client)?.length).toBe(frames(a.socket).length);
    expect(observed.get(b.client)?.length).toBe(frames(b.socket).length);

    // Active current invitation C must be revoked after A→D crown transfer.
    expect(
      authority.submit(a.client, action("national_offer_empire", C.id, "5")),
    ).toBe(true);
    twice(authority);
    expect(latest(c.socket).nationalAccessionOffers?.offers).toHaveLength(1);
    expect(
      authority.submit(a.client, action("national_transfer_crown", D.id, "6")),
    ).toBe(true);
    twice(authority);
    expect(game.nationalPoliticalAuthority()?.emperorOf(ID)).toBe(D.id);
    expect(latest(c.socket).nationalAccessionOffers?.offers).toEqual([]);
    expect(latest(a.socket).nationalAccessionOffers?.offers).toEqual([]);
    expect(latest(b.socket).nationalAccessionOffers?.offers).toEqual([]);
  });

  it("revokes old physical socket, disconnect, spectator and re-used principal without replaying private receipts", async () => {
    const { authority, sockets } = await realMatch();
    const [a, b, c, d] = sockets;
    authority.tick();
    const countB = frames(b.socket).length;
    const forgedNext: TestSocket = {
      readyState: 1,
      frames: [],
      send(bytes) {
        this.frames.push(bytes);
      },
    };
    b.client.ws = forgedNext as unknown as Client["ws"]; // same client ID, DIFFERENT connection
    expect(
      authority.submit(b.client, action("national_offer_empire", A.id, "7")),
    ).toBe(false);
    authority.tick();
    expect(frames(b.socket).length).toBe(countB);
    expect(forgedNext.frames).toHaveLength(0);
    b.client.ws = b.socket as unknown as Client["ws"]; // old socket can never resurrect
    authority.tick();
    expect(frames(b.socket).length).toBe(countB);

    const countC = frames(c.socket).length;
    c.client.spectator = true;
    authority.tick();
    expect(frames(c.socket).length).toBe(countC);
    expect(
      authority.submit(c.client, action("national_offer_empire", A.id, "8")),
    ).toBe(false);
    c.client.spectator = false;
    authority.tick();
    expect(frames(c.socket).length).toBe(countC);

    const countA = frames(a.socket).length;
    a.socket.readyState = 3;
    authority.tick();
    expect(frames(a.socket).length).toBe(countA);
    expect(
      authority.submit(a.client, action("national_offer_empire", C.id, "9")),
    ).toBe(false);
    a.socket.readyState = 1;
    authority.tick();
    expect(frames(a.socket).length).toBe(countA);
    // An unaffected seat continues to receive its own current tick.
    expect(frames(d.socket).length).toBeGreaterThan(countA);
  });

  it("the E3 callback and projector block raw Game, foreign receipts, WAR and credential canaries", async () => {
    const { authority, sockets, game } = await realMatch();
    const [a, b, c] = sockets;
    expect(
      authority.submit(a.client, {
        type: "national_found_empire",
        empireId: ID,
        requestId: "found_private_c5",
      }),
    ).toBe(true);
    twice(authority);
    const packetB = latest(b.socket);
    const packetC = latest(c.socket);
    expect(packetB.nationalPolitics).toEqual(packetC.nationalPolitics);
    for (const key of [
      "packedAttackUpdates",
      "packedMotionPlans",
      "packedNukeImpacts",
      "nationalWarState",
      "gameSnapshot",
      "privateTreatyTerms",
    ])
      expect(packetB).not.toHaveProperty(key);
    const safeJson = JSON.stringify(packetB);
    for (const secret of [
      "verified-independent-",
      "separate-persistent-",
      "groupToken",
      "replayDigest",
      "nationalWarState",
      "privateTreatyTerms",
    ])
      expect(safeJson).not.toContain(secret);

    // Host-frame poisoning cannot persuade E3's projectGameUpdate to forward
    // client-supplied private pacts, foreign command receipts or raw attacks.
    const connection = {
      clientID: C.clientID!,
      sessionId: "server-minted-c5-negative",
      isConnected: () => true,
      isSpectator: () => false,
    };
    const e3 = new NationalServerRecipientSession(game, connection);
    const raw = {
      ...packetB,
      credentials: "SECRET_CREDENTIAL_C5",
      privateTreatyTerms: { text: "SECRET_TREATY_C5" },
      nationalWarState: { fullLedger: "SECRET_WAR_C5" },
      packedAttackUpdates: new Float64Array([777777]),
      nationalCommandResults: [
        {
          actorId: A.id,
          recipientId: A.id,
          type: "national_found_empire" as const,
          requestId: "nf_forged",
          sequence: 999,
          accepted: true,
          reason: "accepted",
          empireId: ID,
          tick: packetB.tick,
        },
      ],
    };
    const filtered = e3.projectGameUpdate(raw);
    expect(filtered?.nationalPolitics).toEqual(packetC.nationalPolitics);
    for (const key of [
      "credentials",
      "privateTreatyTerms",
      "nationalWarState",
      "packedAttackUpdates",
      "nationalCommandResults",
    ])
      expect(filtered).not.toHaveProperty(key);
    expect(JSON.stringify(filtered)).not.toContain("SECRET_");
  });
});
