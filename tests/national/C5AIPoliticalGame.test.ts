/**
 * C5 E4 acceptance: actual Game-owned political receipts, live observation,
 * NationExecution, GameRunner and deterministic GameSnapshot roundtrips.
 */
import {
  Cell,
  Nation,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NationalUltimatumExecution } from "@openfront/engine/execution/NationalUltimatumExecution";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import { describe, expect, it, vi } from "vitest";
import { setup } from "../util/Setup";
import { diffSnapshots, roundTrip } from "../util/Snapshot";

const A = "C5AIBOTAL";
const B = "C5AIBOTBR";
const H = "C5AIHUMAN";
const CLIENT = "C5AICLIENT";
const gameID = "c5-ai-politics";
const a = new PlayerInfo("Alpha", PlayerType.Nation, null, A);
const b = new PlayerInfo("Bravo", PlayerType.Nation, null, B);
const h = new PlayerInfo("Human", PlayerType.Human, CLIENT, H);
const na = new Nation(new Cell(15, 25), a);
const nb = new Nation(new Cell(55, 25), b);

async function seeded(
  firstFraction = 0.35,
  secondFraction = 0.7,
  openNeutral = false,
): Promise<Game> {
  const game = await setup(
    "plains",
    { nationalMode: true },
    [h],
    undefined,
    undefined,
    true,
    [na, nb],
  );
  game.addExecution(
    new NationExecution(gameID, na),
    new NationExecution(gameID, nb),
    new SpawnExecution(gameID, a, game.ref(15, 25)),
    new SpawnExecution(gameID, b, game.ref(55, 25)),
    new SpawnExecution(gameID, h, game.ref(85, 85)),
  );
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  const first = Math.floor(game.width() * firstFraction);
  const second = Math.floor(game.width() * secondFraction);
  for (let y = 0; y < game.height(); y++) {
    for (let x = 0; x < game.width(); x++) {
      const tile = game.ref(x, y);
      if (!game.isLand(tile) || game.isImpassable(tile)) continue;
      if (
        openNeutral &&
        y > game.height() / 2 &&
        x >= first - 2 &&
        x < first + 1
      )
        continue;
      const id = x < first ? A : x < second ? B : H;
      game.player(id).conquer(tile);
    }
  }
  game.player(A).setTroops(260_000);
  game.player(B).setTroops(240_000);
  game.player(H).setTroops(200_000);
  return game;
}

function humanTurn(
  runner: GameRunner,
  game: Game,
  intent?: Record<string, unknown>,
): void {
  runner.addTurn({
    turnNumber: game.ticks(),
    intents:
      intent === undefined
        ? []
        : [StampedIntentSchema.parse({ ...intent, clientID: CLIENT })],
  });
  expect(runner.executeNextTick()).toBe(true);
}

function runnerFor(game: Game): GameRunner {
  return new GameRunner(
    game,
    new Executor(game, gameID, undefined),
    () => {},
    CLIENT,
  );
}

describe("C5 E4 live constitutional political AI (AI-01/03/04/05/06; COAL)", () => {
  it("two actual bots create, invite, accept and defend a lawful treaty; snapshot replays exactly", async () => {
    const game = await seeded();
    // Low-resource sovereigns choose a treaty rather than an elective war.
    game.player(A).setTroops(400);
    game.player(B).setTroops(400);
    const runner = runnerFor(game);
    const observed = collectLiveNationalObservation(game, A).observation;
    expect(observed.frontiers.some((f) => f.targetId === B)).toBe(true);
    expect(JSON.stringify(observed)).not.toContain("controllerKind");

    let established = false;
    for (let t = 0; t < 90; t++) {
      humanTurn(runner, game);
      established ||=
        game.nationalPoliticalAuthority()?.protectedByTreaty(A, B) === true;
      if (established) break;
    }
    expect(established).toBe(true);
    const live = collectLiveNationalObservation(game, A).observation;
    const pact = live.coalitions.find(
      (c) =>
        (c.kind === "nap" || c.kind === "mda") &&
        c.members.includes(A) &&
        c.members.includes(B),
    );
    expect(pact).toBeDefined();
    expect(game.nationalPoliticalAuthority()?.protectedByTreaty(A, B)).toBe(
      true,
    );
    expect(game.nationalWarAuthority()?.authorizeOffensiveAction(A, B)).toBe(
      false,
    );
    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect([...bytes]).toEqual([...again]);
    expect(restored.nationalPoliticalAuthority()?.protectedByTreaty(A, B)).toBe(
      true,
    );
    for (let i = 0; i < 6; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    const left = await roundTrip(game, "plains");
    const right = await roundTrip(restored, "plains");
    expect(diffSnapshots(left.bytes, right.bytes)).toEqual([]);
  });

  it("a threatened bot accepts a human-offered empire through real validator and serves its victory", async () => {
    const game = await seeded(0.18, 0.55, true);
    // Establish the legitimate human offer BEFORE the first AI planning
    // tick, so its acceptance cannot race the AI's own shelter proposal.
    game.performNationalCommand(game.player(H), {
      kind: "found-empire",
      empireId: "c5_human_crown",
    });
    const invitation = game.performNationalPoliticalCommandWithOutcome(
      game.player(H),
      { kind: "offer-empire", empireId: "c5_human_crown", candidateId: A },
    );
    expect(invitation.accepted).toBe(true);
    // A public, actual WAR layer supplies an existential rather than a
    // fabricated threat. The AI receives no private B troop intelligence.
    const war = game.performNationalWarCommandWithOutcome(game.player(B), {
      kind: "declare-national",
      aggressorId: B,
      targetId: A,
      warId: "c5_threat_A",
    });
    expect(war.accepted).toBe(true);
    const runner = runnerFor(game);
    let accepted = false;
    for (let i = 0; i < 70; i++) {
      humanTurn(runner, game);
      accepted =
        game.nationalPoliticalAuthority()?.empireOf(A) === "c5_human_crown";
      if (accepted) break;
    }
    expect(accepted).toBe(true);
    const empire = game
      .nationalPublicPoliticalView()
      ?.empires.find((entry) => entry.id === "c5_human_crown");
    expect(empire?.memberIds).toContain(A);
    expect(empire?.leaderId).toBe(H);
    const postAccession = collectLiveNationalObservation(game, A).observation;
    expect(postAccession.nations.find((n) => n.id === A)?.status).toBe(
      "member",
    );
    expect(postAccession.unownedFrontier).toBe(true);
    // Military survival during an existing hostile WAR is not equivalent
    // to immediate net territorial gain. Accession must remain legal and
    // durable even when the neighbor continues the original real attack.
    const { restored } = await roundTrip(game, "plains");
    expect(restored.nationalPoliticalAuthority()?.empireOf(A)).toBe(
      "c5_human_crown",
    );
  });

  it("an imperial AI member executes useful neutral expansion, retaining the real crown", async () => {
    const game = await seeded(0.18, 0.55, true);
    game.player(B).setTroops(100); // A separate warless imperial growth witness.
    const founder = game.player(H);
    game.performNationalCommand(founder, {
      kind: "found-empire",
      empireId: "c5_growth_crown",
    });
    const invitation = game.performNationalPoliticalCommandWithOutcome(
      founder,
      { kind: "offer-empire", empireId: "c5_growth_crown", candidateId: A },
    );
    expect(invitation.accepted).toBe(true);
    const accession = game.performNationalPoliticalCommandWithOutcome(
      game.player(A),
      { kind: "accept-empire", empireId: "c5_growth_crown", candidateId: A },
    );
    expect(accession.accepted).toBe(true);
    const seen = collectLiveNationalObservation(game, A).observation;
    expect(seen.unownedFrontier).toBe(true);
    const before = game.player(A).numTilesOwned();
    const runner = runnerFor(game);
    for (let i = 0; i < 80; i++) humanTurn(runner, game);
    expect(game.player(A).numTilesOwned()).toBeGreaterThan(before);
    expect(game.nationalPoliticalAuthority()?.empireOf(A)).toBe(
      "c5_growth_crown",
    );
    const { restored } = await roundTrip(game, "plains");
    expect(restored.nationalPoliticalAuthority()?.empireOf(A)).toBe(
      "c5_growth_crown",
    );
  });

  it("an addressed but hostile live NAP invitation is observed and refused", async () => {
    const game = await seeded();
    game.performNationalCommand(game.player(B), {
      kind: "found-pact",
      pactId: "c5_hostile_invite",
      name: "Hostile invitation",
      pactKind: "NAP",
      terms: { admission: "leader", expulsion: "forbidden" },
    });
    game.performNationalCommand(game.player(B), {
      kind: "invite-pact",
      pactId: "c5_hostile_invite",
      candidateId: A,
    });
    const war = game.performNationalWarCommandWithOutcome(game.player(A), {
      kind: "declare-national",
      aggressorId: A,
      targetId: B,
      warId: "c5_hostile_active_war",
    });
    expect(war.accepted).toBe(true);
    const observer = collectLiveNationalObservation(game, A).observation;
    expect(
      observer.coalitions.find((c) => c.id === "c5_hostile_invite")?.invited,
    ).toBe(true);
    const dispatch = vi.spyOn(
      game,
      "performNationalPoliticalCommandWithOutcome",
    );
    const runner = runnerFor(game);
    for (let i = 0; i < 35; i++) humanTurn(runner, game);
    expect(game.nationalPoliticalAuthority()?.protectedByTreaty(A, B)).toBe(
      false,
    );
    expect(
      dispatch.mock.calls.some(
        (args) =>
          args[0].id() === A &&
          args[1].kind === "accept-pact" &&
          args[1].pactId === "c5_hostile_invite",
      ),
    ).toBe(false);
    dispatch.mockRestore();
  });

  it("AI Betray is accepted BEFORE any WAR against a formerly protected partner", async () => {
    const game = await seeded(0.6, 0.7);
    const actor = game.player(A);
    const neighbor = game.player(B);
    const crown = "c5_pact_betray";
    for (const [player, command] of [
      [
        actor,
        {
          kind: "found-pact",
          pactId: crown,
          name: "Treaty",
          pactKind: "NAP",
          terms: { admission: "leader", expulsion: "forbidden" },
        },
      ],
      [actor, { kind: "invite-pact", pactId: crown, candidateId: B }],
      [neighbor, { kind: "accept-pact", pactId: crown }],
    ] as const) {
      game.performNationalCommand(player, command);
    }
    expect(game.nationalPoliticalAuthority()?.protectedByTreaty(A, B)).toBe(
      true,
    );
    const blocked = new AttackExecution(2_000, actor, B);
    blocked.init(game, game.ticks());
    expect(blocked.isActive()).toBe(false);
    const troopsBefore = actor.troops();
    const politics = vi.spyOn(
      game,
      "performNationalPoliticalCommandWithOutcome",
    );
    const wars = vi.spyOn(game, "performNationalWarCommandWithOutcome");
    let betrayalTick: number | null = null;
    let warTick: number | null = null;
    for (let i = 0; i < 95; i++) {
      game.executeNextTick();
      if (
        betrayalTick === null &&
        politics.mock.calls.some(
          (args, index) =>
            args[0].id() === A &&
            args[1].kind === "betray-pact" &&
            politics.mock.results[index].type === "return" &&
            politics.mock.results[index].value?.accepted === true,
        )
      )
        betrayalTick = game.ticks();
      if (
        warTick === null &&
        wars.mock.calls.some(
          (args, index) =>
            args[0].id() === A &&
            args[1].kind === "declare-national" &&
            args[1].targetId === B &&
            wars.mock.results[index].type === "return" &&
            wars.mock.results[index].value?.accepted === true,
        )
      )
        warTick = game.ticks();
      if (betrayalTick !== null && warTick !== null) break;
    }
    politics.mockRestore();
    wars.mockRestore();
    expect(betrayalTick).not.toBeNull();
    expect(game.nationalPoliticalAuthority()?.protectedByTreaty(A, B)).toBe(
      false,
    );
    expect(warTick).not.toBeNull();
    expect(warTick!).toBeGreaterThan(betrayalTick!);
    expect(game.nationalWarAuthority()?.atWar(A, B)).toBe(true);
    // Betray removed treaty protection; a Game-authorized offensive action
    // must now spend real troops or create an actual outgoing attack.
    expect(
      actor.troops() < troopsBefore || actor.outgoingAttacks().length > 0,
    ).toBe(true);
    const { restored } = await roundTrip(game, "plains");
    expect(restored.nationalWarAuthority()?.atWar(A, B)).toBe(true);
  });

  it("C5 C2 integrated E3/E6: ordinary NationExecution rejects an unreachably threatening real imperial ultimatum", async () => {
    const game = await seeded();
    const crown = "c5_c2_real_bot_ultimatum";
    game.performNationalCommand(game.player(H), {
      kind: "found-empire",
      empireId: crown,
    });
    // The issuer has real crown authority, but no observed frontier to bot A.
    // The bot must reject the bluff through E3's own game execution—not a
    // planner-only fixture, direct record edit, or artificial Game receipt.
    game.addExecution(
      new NationalUltimatumExecution(
        game.player(H),
        {
          type: "national_issue_ultimatum",
          empireId: crown,
          targetId: A,
          threat: "imperial-war",
          durationTicks: 600,
          requestId: "c5_c2_real_e3_e6_issue",
        },
        CLIENT,
      ),
    );
    // The Game initializes newly queued executions after the active tick.
    // Execute the second real tick so the E3 command, not a fixture, issues.
    game.executeNextTick();
    game.executeNextTick();
    const initial = NationalUltimatumExecution.viewFor(game, game.player(A));
    expect(initial).toHaveLength(1);
    expect(initial[0]).toMatchObject({
      phase: "pending",
      role: "recipient",
      issuerId: H,
      targetId: A,
    });
    expect(NationalUltimatumExecution.viewFor(game, game.player(B))).toEqual(
      [],
    );
    const runner = runnerFor(game);
    let refused = false;
    for (let i = 0; i < 120; i++) {
      humanTurn(runner, game);
      const view = NationalUltimatumExecution.viewFor(game, game.player(A))[0];
      if (view?.response === "refuse") {
        expect(view.phase).toBe("decision-required");
        refused = true;
        break;
      }
    }
    expect(refused).toBe(true);
    // The Game prunes the one-shot response executor after its real tick.
    // The original issuing execution persists as the authoritative ledger;
    // its recipient-only recorded decision is proof of the AI action.
    expect(
      game.executions().filter((x) => x instanceof NationalUltimatumExecution),
    ).toHaveLength(1);
    expect(
      NationalUltimatumExecution.viewFor(game, game.player(A))[0],
    ).toMatchObject({ phase: "decision-required", response: "refuse" });
    expect(game.nationalPoliticalAuthority()?.empireOf(A)).toBeNull();
    expect(game.nationalWarAuthority()?.atWar(H, A)).toBe(false);
    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(
      NationalUltimatumExecution.viewFor(restored, restored.player(A))[0],
    ).toMatchObject({
      phase: "decision-required",
      response: "refuse",
    });
    for (let i = 0; i < 4; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    const original = await roundTrip(game, "plains");
    const replay = await roundTrip(restored, "plains");
    expect(diffSnapshots(original.bytes, replay.bytes)).toEqual([]);
  });
});
