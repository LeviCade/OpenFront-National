/**
 * Fifth Conductor / Class One / E3 — WAR-02..09, WAR-12, COAL-06.
 * Actual five-nation Private GameRunner -> TrustedNationalMatch -> Executor
 * -> GameImpl, with original independently declared national WAR and
 * emperor-configured standing accession response. No synthesized command
 * acceptance, mock ledger, fake troop debit or client-chosen identity.
 */
import {
  GameMode, GameType, PlayerInfo, PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameConfig } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { Client } from "../../src/server/Client";
import { TrustedNationalMatch } from "../../src/server/national/TrustedNationalMatch";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";
import { TestConfig } from "../util/TestConfig";

const MATCH = "C5E3WAR1";
const IMP = "C5E3_EMPIRE";
const [A, B, C, D, E] = [
  "C5E3RUL01", "C5E3MEM02", "C5E3MEM03", "C5E3FRN04", "C5E3FRN05",
];
const clients = ["C5E3CLI1", "C5E3CLI2", "C5E3CLI3", "C5E3CLI4", "C5E3CLI5"];
const roster = [
  new PlayerInfo("Emperor", PlayerType.Human, clients[0], A),
  new PlayerInfo("Independent at war", PlayerType.Human, clients[1], B),
  new PlayerInfo("Undelegated citizen", PlayerType.Human, clients[2], C),
  new PlayerInfo("Foreign enemy", PlayerType.Human, clients[3], D),
  new PlayerInfo("Independent outsider", PlayerType.Human, clients[4], E),
];
class HostConfig extends TestConfig {
  constructor(config: GameConfig, replay: boolean) {
    super(config, replay, false, false, true);
  }
}
function seat(clientID: string): Client {
  return new Client(
    clientID, "persistent-" + clientID,
    {} as NonNullable<Client["claims"]>, null, undefined, "127.0.0.1",
    clientID, null, { readyState: WebSocket.OPEN } as Client["ws"],
    undefined, clientID, [],
  );
}
async function match() {
  const game = await setup(
    "plains",
    { nationalMode: true, gameType: GameType.Private, gameMode: GameMode.FFA },
    roster, undefined, HostConfig,
  );
  const coords: [number, number][] = [
    [20, 20], [80, 20], [20, 80], [80, 80], [50, 50],
  ];
  roster.forEach((p, i) => {
    game.addExecution(new SpawnExecution(MATCH, p, game.ref(...coords[i])));
  });
  game.executeNextTick();
  game.executeNextTick();
  for (const p of roster) expect(game.player(p.id).hasSpawned()).toBe(true);
  const runner = new GameRunner(game, new Executor(game, MATCH, undefined),
    () => {}, undefined);
  const hostClients = clients.map(seat);
  const host = new TrustedNationalMatch(MATCH, runner, hostClients, () => {});
  return { game, host, hostClients };
}
type Match = Awaited<ReturnType<typeof match>>;
function admit(m: Match, seatIndex: number, payload: Record<string, unknown>) {
  expect(m.host.submit(m.hostClients[seatIndex], payload)).toBe(true);
}
function execute(m: Match) {
  expect(m.host.tick().committedIntents).toBeGreaterThan(0);
  m.host.tick();
}
function act(m: Match, seatIndex: number, payload: Record<string, unknown>) {
  admit(m, seatIndex, payload);
  execute(m);
}
function political(m: Match, actor: string, id: string) {
  const result = m.game.nationalPoliticalCommandResults(m.game.player(actor))
    .find((v) => v.requestId === id);
  expect(result).toBeDefined();
  return result!;
}
function military(m: Match, actor: string, id: string) {
  const result = m.game.nationalWarCommandResults(m.game.player(actor))
    .find((v) => v.requestId === id);
  expect(result).toBeDefined();
  return result!;
}
function war(m: Match, id: string) {
  const layer = m.game.nationalWarState()?.wars.layers.find((l) => l.id === id);
  expect(layer).toBeDefined();
  return layer!;
}
function policy(version: number, response: "none" | "imperial",
  declarationDelegates: string[] = [], peaceDelegates: string[] = []) {
  return {
    type: "national_imperial_administration",
    command: { kind: "set-war-policy", empireId: IMP, expectedVersion: version,
      response, declarationDelegates, peaceDelegates },
  };
}
function found(m: Match) {
  act(m, 0, { type: "national_found_empire", empireId: IMP,
    requestId: "c5_found" });
  expect(m.game.nationalPoliticalAuthority()?.emperorOf(IMP)).toBe(A);
}
function join(m: Match, member: 1 | 2) {
  act(m, 0, { type: "national_offer_empire", empireId: IMP,
    candidateId: member === 1 ? B : C, requestId: "c5_offer_" + member });
  act(m, member, { type: "national_accept_empire", empireId: IMP,
    candidateId: member === 1 ? B : C, requestId: "c5_join_" + member });
  expect(political(m, member === 1 ? B : C, "c5_join_" + member).accepted).toBe(true);
}
function balances(game: Game) {
  return roster.map((p) => {
    const player = game.player(p.id);
    return [p.id, player.gold().toString(), player.troops()] as const;
  });
}

describe("C5 E3 — real imperial response and member-specific WAR law", () => {
  it("preserves the founding national war, obeys policy at consented accession, rejects impostor powers, preserves scoped peace and replays", async () => {
    const m = await match();
    const baseline = balances(m.game);
    // An INDEPENDENT nation begins a real national war, before any accession.
    act(m, 1, { type: "national_declare_war", scope: "national",
      nationId: B, targetId: D, targetKind: "nation", requestId: "c5_original" });
    const nationalId = military(m, B, "c5_original").warId!;
    expect(war(m, nationalId).scope).toBe("national");
    found(m);
    act(m, 0, { ...policy(0, "imperial"), requestId: "c5_policy_1" });
    expect(political(m, A, "c5_policy_1").accepted).toBe(true);
    join(m, 1);
    const layers = m.game.nationalWarState()!.wars.layers.filter(
      (l) => l.endedTick === null);
    expect(layers).toHaveLength(2);
    const imperial = layers.find((l) => l.scope === "imperial")!;
    expect(imperial.first).toEqual({ kind: "empire", id: IMP });
    expect(imperial.second).toEqual({ kind: "nation", id: D });
    expect(war(m, nationalId).endedTick).toBeNull();
    expect(m.game.nationalWarAuthority()?.atWar(A, D)).toBe(true);
    expect(m.game.nationalWarAuthority()?.atWar(B, D)).toBe(true);
    expect(m.game.nationalWarAuthority()?.atWar(C, D)).toBe(false);

    // A different non-delegated subordinate joins. Admission is consented.
    join(m, 2);
    expect(m.game.nationalWarAuthority()?.atWar(C, D)).toBe(true);
    act(m, 0, { ...policy(1, "imperial", [B], [B]), requestId: "c5_grants" });
    expect(political(m, A, "c5_grants").accepted).toBe(true);
    expect(m.game.nationalPoliticalAuthority()?.mayDeclareNational(B)).toBe(true);
    expect(m.game.nationalPoliticalAuthority()?.mayDeclareNational(C)).toBe(false);
    expect(m.game.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(true);

    act(m, 1, { type: "national_declare_war", scope: "national", nationId: B,
      targetId: E, targetKind: "nation", requestId: "c5_delegated" });
    expect(military(m, B, "c5_delegated").accepted).toBe(true);
    act(m, 2, { type: "national_declare_war", scope: "national", nationId: C,
      targetId: E, targetKind: "nation", requestId: "c5_undelegated" });
    expect(military(m, C, "c5_undelegated").accepted).toBe(false);
    act(m, 1, { type: "national_declare_war", scope: "imperial", nationId: B,
      targetId: E, targetKind: "nation", requestId: "c5_forged_imperial" });
    expect(military(m, B, "c5_forged_imperial").accepted).toBe(false);
    expect(m.game.nationalWarAuthority()?.atWar(C, E)).toBe(false);

    // Only the emperor may accept an empire peace motion. The original
    // national WAR must remain effective for B after the imperial layer ends.
    act(m, 3, { type: "national_propose_peace", warId: imperial.id,
      requestId: "c5_imperial_offer" });
    const motion = military(m, D, "c5_imperial_offer");
    expect(motion.accepted).toBe(true);
    act(m, 1, { type: "national_accept_peace", motionId: motion.motionId!,
      requestId: "c5_subordinate_imperial_peace" });
    expect(military(m, B, "c5_subordinate_imperial_peace").accepted).toBe(false);
    act(m, 0, { type: "national_accept_peace", motionId: motion.motionId!,
      requestId: "c5_imperial_peace" });
    expect(military(m, A, "c5_imperial_peace").accepted).toBe(true);
    expect(war(m, imperial.id).endedTick).not.toBeNull();
    expect(war(m, nationalId).endedTick).toBeNull();
    expect(m.game.nationalWarAuthority()?.atWar(A, D)).toBe(false);
    expect(m.game.nationalWarAuthority()?.atWar(C, D)).toBe(false);
    expect(m.game.nationalWarAuthority()?.atWar(B, D)).toBe(true);
    expect(m.game.nationalWarAuthority()?.authorizeOffensiveAction(A, D)).toBe(false);
    expect(m.game.nationalWarAuthority()?.authorizeOffensiveAction(B, D)).toBe(true);
    expect(balances(m.game)).toEqual(baseline);

    const { restored, bytes, again } = await roundTrip(m.game, "plains");
    expect(again).toEqual(bytes);
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(m.game));
    expect(restored.nationalWarState()).toEqual(m.game.nationalWarState());
    expect(restored.nationalPoliticalAuthority()?.mayDeclareNational(B)).toBe(true);
    expect(restored.nationalWarAuthority()?.atWar(B, D)).toBe(true);
    expect(balances(restored)).toEqual(balances(m.game));
  });

  it("denies stale delegated requests after revocation and old emperor after crown transfer, preserving identical queued replay", async () => {
    const m = await match();
    found(m);
    join(m, 1);
    join(m, 2);
    act(m, 0, { ...policy(0, "none", [B], [B]),
      requestId: "c5_old_grant" });
    expect(m.game.nationalPoliticalAuthority()?.mayDeclareNational(B)).toBe(true);
    const before = balances(m.game);
    // Same-tick ordering: revoke, then try the request admitted under v1.
    admit(m, 0, { ...policy(1, "none", [], []), requestId: "c5_revoke" });
    admit(m, 1, { type: "national_declare_war", scope: "national", nationId: B,
      targetId: D, targetKind: "nation", requestId: "c5_stale_delegate" });
    expect(m.host.tick().committedIntents).toBe(2);
    const { restored, bytes, again } = await roundTrip(m.game, "plains");
    expect(bytes).toEqual(again);
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(m.game));
    m.host.tick();
    restored.executeNextTick();
    expect(military(m, B, "c5_stale_delegate").accepted).toBe(false);
    expect(political(m, A, "c5_revoke").accepted).toBe(true);
    expect(restored.nationalWarState()).toEqual(m.game.nationalWarState());
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(m.game));
    expect(m.game.nationalWarAuthority()?.atWar(B, D)).toBe(false);
    expect(balances(m.game)).toEqual(before);

    // The same emperor cannot replay a stale CAS policy write.
    act(m, 0, { ...policy(1, "imperial", [B], []),
      requestId: "c5_stale_policy" });
    expect(political(m, A, "c5_stale_policy").accepted).toBe(false);

    // Order is authoritative: transfer first, old emperor's queued
    // empire-wide declaration later, even if his client remains connected.
    admit(m, 0, { type: "national_transfer_crown", empireId: IMP,
      successorId: C, requestId: "c5_crown" });
    admit(m, 0, { type: "national_declare_war", scope: "imperial",
      nationId: A, targetId: E, targetKind: "nation",
      requestId: "c5_old_emperor_war" });
    execute(m);
    expect(political(m, A, "c5_crown").accepted).toBe(true);
    expect(military(m, A, "c5_old_emperor_war").accepted).toBe(false);
    expect(m.game.nationalPoliticalAuthority()?.emperorOf(IMP)).toBe(C);
    expect(m.game.nationalPoliticalAuthority()?.mayDeclareNational(B)).toBe(false);
    expect(m.game.nationalWarAuthority()?.atWar(A, E)).toBe(false);
    expect(balances(m.game)).toEqual(before);
    const { restored: afterTransfer } = await roundTrip(m.game, "plains");
    expect(snapshotGameData(afterTransfer)).toEqual(snapshotGameData(m.game));
    expect(afterTransfer.nationalPoliticalAuthority()?.emperorOf(IMP)).toBe(C);
  });

  it("defaults to no accession escalation without explicit emperor policy", async () => {
    const m = await match();
    act(m, 1, { type: "national_declare_war", scope: "national",
      nationId: B, targetId: D, targetKind: "nation",
      requestId: "c5_independent_default" });
    found(m);
    join(m, 1);
    expect(m.game.nationalWarState()?.wars.layers.filter(
      (l) => l.endedTick === null)).toHaveLength(1);
    expect(m.game.nationalWarAuthority()?.atWar(A, D)).toBe(false);
    expect(m.game.nationalWarAuthority()?.atWar(B, D)).toBe(true);
  });
});
