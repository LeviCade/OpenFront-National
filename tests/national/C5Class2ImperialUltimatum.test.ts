import {
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import {
  StampedIntentSchema,
  type GameConfig,
} from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NationalUltimatumExecution } from "@openfront/engine/execution/NationalUltimatumExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { projectNationalUltimatums } from "@openfront/engine/national/observation/NationalOutbound";
import { NationalServerRecipientSession } from "@openfront/engine/national/observation/NationalServerOutbound";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { Client } from "../../src/server/Client";
import { TrustedNationalMatch } from "../../src/server/national/TrustedNationalMatch";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";
import { TestConfig } from "../util/TestConfig";

const MATCH = "C5_C2_ULTIMATUM";
const EMPIRE = "c5_c2_empire";
const IDS = ["C5EMPEROR", "C5TARGET0", "C5OUTSIDE", "C5MEMBER0"];
const CLIENTS = ["C5CLIENT1", "C5CLIENT2", "C5CLIENT3", "C5CLIENT4"];
const roster = IDS.map(
  (id, i) => new PlayerInfo(id, PlayerType.Human, CLIENTS[i], id),
);

class PrivateNationalConfig extends TestConfig {
  constructor(config: GameConfig, replay: boolean) {
    super(config, replay, false, false, true);
  }
}
function seat(id: string, i: number): Client {
  return new Client(
    id,
    "imperial-" + id,
    {} as NonNullable<Client["claims"]>,
    null,
    undefined,
    "127.0.0.1",
    id,
    null,
    { readyState: WebSocket.OPEN } as Client["ws"],
    undefined,
    "imperial-account-" + i,
    [],
  );
}

async function fixture() {
  const game = await setup(
    "plains",
    { nationalMode: true, gameType: GameType.Private, gameMode: GameMode.FFA },
    roster,
    undefined,
    PrivateNationalConfig,
  );
  const positions = [
    [20, 20],
    [75, 20],
    [20, 75],
    [75, 75],
  ];
  roster.forEach((info, i) => {
    const [x, y] = positions[i];
    game.addExecution(new SpawnExecution(MATCH, info, game.ref(x, y)));
  });
  game.executeNextTick();
  game.executeNextTick();
  const runner = new GameRunner(
    game,
    new Executor(game, MATCH, undefined),
    () => {},
    undefined,
  );
  const sockets = CLIENTS.map(seat);
  const host = new TrustedNationalMatch(MATCH, runner, sockets, () => {});
  const view = (i: number) =>
    NationalUltimatumExecution.viewFor(game, game.player(IDS[i]));
  const act = (i: number, intent: Record<string, unknown>) => {
    expect(host.submit(sockets[i], intent)).toBe(true);
    expect(host.tick().committedIntents).toBe(1);
    host.tick();
  };
  return { game, host, sockets, view, act };
}

type Action = (index: number, intent: Record<string, unknown>) => void;
function establish(act: Action) {
  act(0, {
    type: "national_found_empire",
    empireId: EMPIRE,
    requestId: "c5_c2_found_empire",
  });
}
function recruit(act: Action, index = 3) {
  act(0, {
    type: "national_offer_empire",
    empireId: EMPIRE,
    candidateId: IDS[index],
    requestId: "c5_c2_recruit_offer_" + index,
  });
  act(index, {
    type: "national_accept_empire",
    empireId: EMPIRE,
    candidateId: IDS[index],
    requestId: "c5_c2_recruit_join_" + index,
  });
}
function issue(
  threat: "embargo" | "imperial-war",
  targetId = IDS[1],
  requestId = "c5_c2_issue",
  durationTicks = 20,
) {
  return {
    type: "national_issue_ultimatum",
    empireId: EMPIRE,
    targetId,
    threat,
    durationTicks,
    requestId,
  };
}
function respond(
  ultimatumId: string,
  decision: "accept" | "refuse",
  requestId = "c5_c2_reply",
) {
  return {
    type: "national_respond_ultimatum",
    ultimatumId,
    decision,
    requestId,
  };
}
function resolve(
  ultimatumId: string,
  decision: "enforce" | "back-down" | "withdraw",
  requestId = "c5_c2_decide",
) {
  return {
    type: "national_resolve_ultimatum",
    ultimatumId,
    decision,
    requestId,
  };
}
function assets(game: Game) {
  return IDS.map((id) => {
    const p = game.player(id);
    return {
      id,
      gold: p.gold().toString(),
      trade: p.tradeGold().toString(),
      piracy: p.piracyGold().toString(),
      troops: p.troops(),
    };
  });
}

/** Mirrors the same real-world ticks without an ultimatum command;
 * compare income, troop accrual and balances at the exact same game tick.
 */
function expectNoArtificialResources(game: Game, control: Game): void {
  while (control.ticks() < game.ticks()) control.executeNextTick();
  expect(control.ticks()).toBe(game.ticks());
  expect(assets(game)).toEqual(assets(control));
}

function expectNoIndependentCurrency(before: ReturnType<typeof assets>, game: Game): void {
  const finance = (rows: ReturnType<typeof assets>) => rows.map((r) => ({
    id: r.id, trade: r.trade, piracy: r.piracy,
  }));
  expect(finance(assets(game))).toEqual(finance(before));
}

describe("C5 Class Two ECON-06/07 authenticated imperial ultimatum", () => {
  it("refusal enforces real empire-member embargo; outsiders and sockets never see terms", async () => {
    const { game, act, view } = await fixture();
    establish(act);
    recruit(act);
    const before = assets(game);
    const control = (await roundTrip(game, "plains")).restored;
    expect(game.player(IDS[0]).canTrade(game.player(IDS[1]))).toBe(true);
    expect(game.player(IDS[3]).canTrade(game.player(IDS[1]))).toBe(true);
    act(0, { ...issue("embargo"), clientID: CLIENTS[1] });
    const [demand] = view(0);
    expect(demand).toMatchObject({
      issuerId: IDS[0],
      targetId: IDS[1],
      threat: "embargo",
      phase: "pending",
      version: 1,
    });
    expect(view(1)[0]).toMatchObject({
      id: demand.id,
      role: "recipient",
      requestId: null,
    });
    expect(view(2)).toEqual([]);
    expect(view(3)).toEqual([]);
    expect(projectNationalUltimatums(game, IDS[2])?.items).toEqual([]);
    const serverRecipient = new NationalServerRecipientSession(game, {
      clientID: CLIENTS[1],
      sessionId: "c5_c2_original_socket",
      isConnected: () => true,
      isSpectator: () => false,
    });
    const serverOutsider = new NationalServerRecipientSession(game, {
      clientID: CLIENTS[2],
      sessionId: "c5_c2_other_socket",
      isConnected: () => true,
      isSpectator: () => false,
    });
    expect(
      serverRecipient.projectPolitics()?.nationalUltimatums?.items,
    ).toHaveLength(1);
    expect(serverOutsider.projectPolitics()?.nationalUltimatums?.items).toEqual(
      [],
    );
    act(1, { ...respond(demand.id, "refuse"), clientID: CLIENTS[0] });
    expect(view(0)[0].phase).toBe("decision-required");
    expect(game.nationalWarAuthority()?.atWar(IDS[0], IDS[1])).toBe(false);
    act(0, resolve(demand.id, "enforce"));
    expect(view(0)[0]).toMatchObject({
      phase: "enforced",
      credibility: "kept",
      imposedMembers: expect.arrayContaining([IDS[0], IDS[3]]),
    });
    expect(game.player(IDS[0]).canTrade(game.player(IDS[1]))).toBe(false);
    expect(game.player(IDS[3]).canTrade(game.player(IDS[1]))).toBe(false);
    expect(game.player(IDS[2]).canTrade(game.player(IDS[1]))).toBe(true);
    expect(game.nationalWarAuthority()?.atWar(IDS[0], IDS[1])).toBe(false);
    expect(game.nationalWarState()!.wars.layers.length).toBe(0);
    expectNoArtificialResources(game, control);
    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect(again).toEqual(bytes);
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
    expect(
      NationalUltimatumExecution.viewFor(restored, restored.player(IDS[1]))[0]
        .phase,
    ).toBe("enforced");
    console.info(
      "C5_C2_ULTIMATUM_EMBARGO_WITNESS=" +
        JSON.stringify({
          source: "GameRunner/TrustedNationalMatch/Executor/Player.addEmbargo",
          before,
          after: assets(game),
          war: false,
          imposed: view(0)[0].imposedMembers,
        }),
    );
  });

  it("acceptance is only consent until the original emperor-offer + recipient-accept both execute", async () => {
    const { game, act, view } = await fixture();
    establish(act);
    const before = assets(game);
    act(0, issue("imperial-war"));
    const id = view(1)[0].id;
    act(1, respond(id, "accept"));
    expect(view(1)[0]).toMatchObject({
      phase: "consented",
      response: "accept",
    });
    expect(game.nationalPoliticalAuthority()?.empireOf(IDS[1])).toBeNull();
    expect(game.nationalWarAuthority()?.atWar(IDS[0], IDS[1])).toBe(false);
    act(0, {
      type: "national_offer_empire",
      empireId: EMPIRE,
      candidateId: IDS[1],
      requestId: "c5_c2_offer",
    });
    expect(game.nationalPoliticalAuthority()?.empireOf(IDS[1])).toBeNull();
    act(1, {
      type: "national_accept_empire",
      empireId: EMPIRE,
      candidateId: IDS[1],
      requestId: "c5_c2_join",
    });
    expect(game.nationalPoliticalAuthority()?.empireOf(IDS[1])).toBe(EMPIRE);
    // The dedicated diplomacy execution settles the political transition on the next tick.
    game.executeNextTick();
    expect(view(1)[0]).toMatchObject({ phase: "acceded", credibility: "kept" });
    act(0, resolve(id, "enforce", "c5_c2_no_war_after_accession"));
    expect(game.nationalWarAuthority()?.atWar(IDS[0], IDS[1])).toBe(false);
    expectNoIndependentCurrency(before, game);
    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect(again).toEqual(bytes);
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
  });

  it("already-open WAR cannot be duplicated by a threat; a new lawful WAR follows refusal", async () => {
    const { game, act, view } = await fixture();
    establish(act);
    // A WAR threat is not permission to create duplicate legal conflict layers.
    act(0, {
      type: "national_declare_war",
      scope: "imperial",
      nationId: IDS[0],
      targetId: IDS[1],
      targetKind: "nation",
      requestId: "c5_c2_prior_war",
    });
    expect(game.nationalWarAuthority()?.atWar(IDS[0], IDS[1])).toBe(true);
    const originalLayers = game.nationalWarState()!.wars.layers.length;
    const before = assets(game);
    const control = (await roundTrip(game, "plains")).restored;
    act(0, issue("imperial-war", IDS[1], "c5_c2_protected"));
    const protectedId = view(0)[0].id;
    act(1, respond(protectedId, "refuse", "c5_c2_protected_refuse"));
    expect(game.nationalWarAuthority()?.atWar(IDS[0], IDS[1])).toBe(true);
    act(0, resolve(protectedId, "enforce", "c5_c2_protected_enforce"));
    expect(view(0)[0]).toMatchObject({
      phase: "backed-down",
      credibility: "broken",
      warId: null,
    });
    expect(game.nationalWarAuthority()?.atWar(IDS[0], IDS[1])).toBe(true);
    expect(game.nationalWarState()!.wars.layers.length).toBe(originalLayers);
    expectNoArtificialResources(game, control);

    act(0, issue("imperial-war", IDS[2], "c5_c2_lawful_war"));
    const lawfulId = view(2)[0].id;
    act(2, respond(lawfulId, "refuse", "c5_c2_lawful_refuse"));
    act(0, resolve(lawfulId, "enforce", "c5_c2_lawful_enforce"));
    expect(game.nationalWarAuthority()?.atWar(IDS[0], IDS[2])).toBe(true);
    const enforced = view(0).find((r) => r.id === lawfulId)!;
    expect(enforced.phase).toBe("enforced");
    expect(enforced.warId).toMatch(/^ultimatum-war-/);
    expect(
      game.nationalWarState()?.wars.layers.some((l) => l.id === enforced.warId),
    ).toBe(true);
    expectNoArtificialResources(game, control);
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect(again).toEqual(bytes);
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
    console.info(
      "C5_C2_ULTIMATUM_WAR_WITNESS=" +
        JSON.stringify({
          before,
          after: assets(game),
          duplicateWarDenied:
            game.nationalWarState()!.wars.layers.length === originalLayers + 1,
          lawfulWar: game.nationalWarAuthority()?.atWar(IDS[0], IDS[2]),
          warId: enforced.warId,
        }),
    );
  });

  it("rejects subordinate issuer, impersonation, reused ID, stale deadline and crown succession", async () => {
    const { game, act, view, host, sockets } = await fixture();
    establish(act);
    recruit(act);
    const before = assets(game);
    act(3, issue("embargo", IDS[1], "subordinate_issue"));
    expect(view(1)).toEqual([]);
    // Wrong browser clientID is ignored; the authenticated socket decides.
    act(1, {
      ...issue("embargo", IDS[2], "impostor_issue"),
      clientID: CLIENTS[0],
    });
    expect(view(2)).toEqual([]);
    act(0, issue("embargo", IDS[1], "original_issue", 2));
    const id = view(1)[0].id;
    expect(host.submit(sockets[0], issue("embargo", IDS[2], "original_issue"))).toBe(false);
    expect(view(2)).toEqual([]);
    host.tick(); // already past the two-tick deadline
    act(1, respond(id, "accept", "late_accept"));
    expect(view(1)[0]).toMatchObject({
      phase: "decision-required",
      response: "none",
    });
    act(0, {
      type: "national_transfer_crown",
      empireId: EMPIRE,
      successorId: IDS[3],
      requestId: "c5_c2_transfer",
    });
    host.tick();
    expect(view(0)).toEqual([]);
    expect(view(1)[0].phase).toBe("expired");
    act(3, resolve(id, "enforce", "stolen_new_crown"));
    act(0, resolve(id, "enforce", "stale_old_crown"));
    expect(game.player(IDS[0]).canTrade(game.player(IDS[1]))).toBe(true);
    expect(game.nationalWarAuthority()?.atWar(IDS[0], IDS[1])).toBe(false);
    expectNoIndependentCurrency(before, game);
    expect(
      host.submit(sockets[1], {
        type: "national_respond_ultimatum",
        ultimatumId: "missing",
        decision: "accept",
        requestId: "foreign_not_a_credential",
        clientID: CLIENTS[0],
      }),
    ).toBe(true);
    host.tick();
    host.tick();
    expect(view(1)[0].phase).toBe("expired");
  });

  it("snapshot/replay executes the exact same queued refusal and resolution without duplicate cost", async () => {
    const { game, act, view } = await fixture();
    establish(act);
    act(0, issue("embargo"));
    const id = view(1)[0].id;
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect(again).toEqual(bytes);
    for (const target of [game, restored]) {
      const executor = new Executor(target, MATCH, undefined);
      target.addExecution(
        executor.createExec(
          StampedIntentSchema.parse({
            ...respond(id, "refuse", "replay_refuse"),
            clientID: CLIENTS[1],
          }),
        ),
      );
      target.executeNextTick();
      target.executeNextTick();
      target.addExecution(
        executor.createExec(
          StampedIntentSchema.parse({
            ...resolve(id, "enforce", "replay_enforce"),
            clientID: CLIENTS[0],
          }),
        ),
      );
      target.executeNextTick();
      target.executeNextTick();
      // Same request cannot produce another embargo, entry or ledger event.
      target.addExecution(
        executor.createExec(
          StampedIntentSchema.parse({
            ...resolve(id, "enforce", "replay_enforce"),
            clientID: CLIENTS[0],
          }),
        ),
      );
      target.executeNextTick();
      target.executeNextTick();
      expect(target.player(IDS[0]).canTrade(target.player(IDS[1]))).toBe(false);
    }
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
  });
});
