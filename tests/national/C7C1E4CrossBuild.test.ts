import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { readSnapshotHeader } from "@openfront/engine/snapshot/GameSnapshot";
import {
  decodeSnapshotValue,
  encodeSnapshotValue,
} from "@openfront/engine/snapshot/SnapshotCodec";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setup } from "../util/Setup";
import { restoreTestGame } from "../util/Snapshot";

const writers = [
  "5e956e13f9e3b054c15cfd75110284c5a48fdd5c",
  "86b476d3ea8aa04821f2caac421738fe2fe1db21",
  "e9eb83cd9a18663d6e40d2b2e88219bed7fccb57",
] as const;
const gameId = "C7E4TEST1";
const empire = "c7e4-empire";
const pact = "c7e4-mda";
const oldWarRequest = "c7e4-old-war";
const ids = ["C7E4NATA", "C7E4NATB", "C7E4NATC", "C7E4NATD"];
const [A, B, C, D] = ids;
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const gitHead = () =>
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const mapDigests = () =>
  Object.fromEntries(
    ["manifest.json", "map.bin", "map4x.bin"].map((name) => [
      name,
      sha256(readFileSync(join("tests/testdata/maps/plains", name))),
    ]),
  );

function attach(game: Game) {
  const errors: string[] = [];
  const runner = new GameRunner(
    game,
    new Executor(game, gameId, undefined),
    (packet) => {
      if ("errMsg" in packet) errors.push(String(packet.errMsg));
    },
    undefined,
  );
  const tick = (...intents: Record<string, unknown>[]) => {
    runner.addTurn({
      turnNumber: game.ticks(),
      intents: intents.map((i) => StampedIntentSchema.parse(i)),
    });
    expect(runner.executeNextTick()).toBe(true);
    expect(errors).toEqual([]);
  };
  return { game, runner, tick };
}

function state(game: Game) {
  const authority = game.nationalPoliticalAuthority()!;
  const wars = game.nationalWarAuthority()!;
  return {
    tick: game.ticks(),
    leader: authority.emperorOf(empire),
    members: [...authority.membersOf(empire)],
    mda: [...game.nationalMdaAllies(B)].sort(),
    protected: authority.protectedByTreaty(B, C),
    atWar: wars.atWar(A, B),
    peaceful: !wars.atWar(A, C),
    recon: ids.flatMap((id) => game.nationalReconnaissanceFor?.(id) ?? []),
    assessments: ids.flatMap((id) => game.nationalAssessmentsFor?.(id) ?? []),
    warReceipts: ids.flatMap(
      (id) => game.nationalWarCommandResults?.(game.player(id)) ?? [],
    ),
    layers: game.nationalWarState()!.wars.layers.map((l) => ({
      id: l.id,
      scope: l.scope,
      endedTick: l.endedTick,
    })),
    players: ids.map((id) => {
      const p = game.player(id);
      return {
        id,
        alive: p.isAlive(),
        tiles: p.numTilesOwned(),
        tileDigest: sha256(
          Buffer.from(JSON.stringify([...p.tiles()].sort((a, b) => a - b))),
        ),
        troops: p.troops(),
        gold: String(p.gold()),
      };
    }),
  };
}

async function produce() {
  const people = ids.map(
    (id, i) => new PlayerInfo(id, PlayerType.Human, "C7E4SEAT" + i, id),
  );
  const game = await setup("plains", { nationalMode: true }, people);
  const m = attach(game);
  m.runner.init();
  const points = [
    [25, 25],
    [33, 25],
    [25, 75],
    [75, 75],
  ];
  for (let i = 0; i < people.length; i++) {
    game.addExecution(
      new SpawnExecution(
        gameId,
        people[i],
        game.ref(points[i][0], points[i][1]),
      ),
    );
  }
  for (let i = 0; i < 3; i++) m.tick();
  for (const id of ids) expect(game.player(id).hasSpawned()).toBe(true);
  // Old writers predate several native pact intents. Exercise their real
  // Game-owned authority API, never synthesize or edit snapshot records.
  game.performNationalCommand(game.player(A), {
    kind: "found-empire",
    empireId: empire,
  });
  game.performNationalCommand(game.player(A), {
    kind: "offer-empire",
    empireId: empire,
    candidateId: D,
  });
  game.performNationalCommand(game.player(D), {
    kind: "accept-empire",
    empireId: empire,
    candidateId: D,
  });
  game.performNationalCommand(game.player(B), {
    kind: "found-pact",
    pactId: pact,
    name: "Historical defense",
    pactKind: "MDA",
    terms: { admission: "leader", expulsion: "forbidden" },
  });
  game.performNationalCommand(game.player(B), {
    kind: "invite-pact",
    pactId: pact,
    candidateId: C,
  });
  game.performNationalCommand(game.player(C), {
    kind: "accept-pact",
    pactId: pact,
  });
  // All three historical writers support native stamped declarations.
  // v4 has no WAR receipt port; v5+ must persist the actual accepted receipt.
  m.tick({
    type: "national_declare_war",
    scope: "national",
    nationId: A,
    targetId: B,
    targetKind: "nation",
    requestId: oldWarRequest,
    clientID: game.player(A).clientID(),
  });
  // Earn funds through actual simulation ticks, then exercise the writer's
  // own paid intelligence records where its pinned version implements them.
  while (game.ticks() < 20) m.tick();
  if (typeof game.performNationalReconnaissance === "function") {
    const payer = game.player(D);
    const before = payer.gold();
    game.performNationalReconnaissance(
      payer,
      B,
      33,
      25,
      "c7e4-recon",
      payer.clientID()!,
    );
    expect(payer.gold()).toBe(before - 500n);
  }
  if (typeof game.performNationalAssessment === "function") {
    const payer = game.player(A);
    const before = payer.gold();
    game.performNationalAssessment(
      payer,
      B,
      "c7e4-assessment",
      payer.clientID()!,
    );
    expect(payer.gold()).toBe(before - 1200n);
  }
  // Use the real Player troop setter to establish an explicitly funded
  // defensive scenario (above the protected reserve) before writing bytes.
  const donor = game.player(C);
  donor.setTroops(Math.floor(game.config().maxTroops(donor) * 0.8));
  const evidence = state(game);
  expect(evidence.leader).toBe(A);
  expect(evidence.members).toEqual([A, D]);
  expect(evidence.mda).toContain(C);
  expect(evidence.protected).toBe(true);
  expect(evidence.atWar).toBe(true);
  expect(evidence.peaceful).toBe(true);
  if (mode === "same-build") {
    expect(evidence.recon).toHaveLength(1);
    expect(evidence.assessments).toHaveLength(1);
    expect(evidence.warReceipts).toHaveLength(1);
  }
  expect(evidence.layers).toHaveLength(1);
  expect(evidence.layers[0]).toMatchObject({
    scope: "national",
    endedTick: null,
  });
  for (const receipt of evidence.warReceipts) {
    expect(receipt).toMatchObject({
      requestId: oldWarRequest,
      actorId: A,
      recipientId: A,
      accepted: true,
      warId: evidence.layers[0].id,
    });
  }
  for (const p of evidence.players) {
    expect(p.alive).toBe(true);
    expect(p.tiles).toBeGreaterThan(0);
    expect(p.troops).toBeGreaterThan(0);
  }
  return m;
}

function continueGame(m: ReturnType<typeof attach>) {
  const before = state(m.game);
  const timeline: string[] = [];
  const tick = (...intents: Record<string, unknown>[]) => {
    m.tick(...intents);
    timeline.push(sha256(m.runner.snapshot()));
  };
  const actor = m.game.player(A);
  const target = m.game.player(C);
  const defender = m.game.player(B);
  expect(actor.sharesBorderWith(defender)).toBe(true);
  tick({
    type: "attack",
    clientID: actor.clientID(),
    targetID: B,
    troops: 5000,
  });
  tick();
  const result = m.game.nationalWarState()!.levy.processed[0].result;
  expect(result.application).toBe("applied");
  expect(result.attackTroopsBefore).toBe(5000);
  expect(result.intercepted).toBeGreaterThan(0);
  expect(result.intercepted + result.remainingAttackingTroops).toBe(5000);
  expect(result.contributions.reduce((n, c) => n + c.troopsDebited, 0)).toBe(
    result.intercepted,
  );
  expect(result.contributions.some((c) => c.nationId === C)).toBe(true);
  // Real stamped intent through GameRunner/Executor, on restored actor.
  tick({
    type: "national_declare_war",
    scope: "national",
    nationId: A,
    targetId: target.id(),
    targetKind: "nation",
    requestId: "c7e4-new-war",
    clientID: actor.clientID(),
  });
  for (let i = 0; i < 4; i++) tick();
  expect(m.game.nationalWarAuthority()?.atWar(A, C)).toBe(true);
  expect(m.game.nationalWarAuthority()?.atWar(A, B)).toBe(true);
  expect(m.game.ticks()).toBe(before.tick + 7);
  expect(timeline).toHaveLength(7);
  expect(m.game.nationalPoliticalAuthority()?.emperorOf(empire)).toBe(A);
  expect(m.game.nationalMdaAllies(B)).toContain(C);
  const after = state(m.game);
  expect(after.recon).toEqual(before.recon);
  expect(after.assessments).toEqual(before.assessments);
  for (const receipt of before.warReceipts)
    expect(after.warReceipts).toContainEqual(receipt);
  // The paid request is immutable and cannot debit its payer twice.
  if (before.recon.length) {
    const payer = m.game.player(D);
    const balance = payer.gold();
    expect(() =>
      m.game.performNationalReconnaissance(
        payer,
        B,
        33,
        25,
        "c7e4-recon",
        payer.clientID()!,
      ),
    ).toThrow();
    expect(payer.gold()).toBe(balance);
  }
  if (before.assessments.length) {
    const balance = actor.gold();
    expect(() =>
      m.game.performNationalAssessment(
        actor,
        B,
        "c7e4-assessment",
        actor.clientID()!,
      ),
    ).toThrow();
    expect(actor.gold()).toBe(balance);
  }
  return { ...state(m.game), interception: result, timeline };
}

type Evidence = ReturnType<typeof state>;
interface Manifest {
  writer: string;
  driverSource: string;
  driverDigest: string;
  gameRecordVersion: number;
  node: string;
  npm: string;
  run: string;
  attempt: string;
  map: ReturnType<typeof mapDigests>;
  digest: string;
  length: number;
  before: Evidence;
}

function verify(bytes: Uint8Array, manifest: Manifest, writer: string) {
  expect(manifest.writer).toBe(writer);
  expect(manifest.driverSource).toMatch(/^[a-f0-9]{40}$/);
  expect(manifest.driverSource).toBe(process.env.CURRENT_SHA);
  expect(manifest.driverDigest).toBe(
    sha256(readFileSync("tests/national/C7C1E4CrossBuild.test.ts")),
  );
  const root = decodeSnapshotValue(bytes) as { game: { v: number } };
  expect(root.game.v).toBe(manifest.gameRecordVersion);
  expect(manifest.before.recon).toHaveLength(root.game.v >= 5 ? 1 : 0);
  expect(manifest.before.assessments).toHaveLength(root.game.v >= 6 ? 1 : 0);
  expect(manifest.before.warReceipts).toHaveLength(root.game.v >= 5 ? 1 : 0);
  expect(root.game.v).toBe(
    writers.indexOf(writer as (typeof writers)[number]) + 4,
  );
  expect(manifest.node).toBe("v24.15.0");
  expect(manifest.npm).toBe("12.1.0");
  expect(manifest.run).toBe(process.env.GITHUB_RUN_ID);
  expect(manifest.attempt).toBe(process.env.GITHUB_RUN_ATTEMPT);
  expect(manifest.map).toEqual(mapDigests());
  expect(manifest.length).toBe(bytes.length);
  expect(manifest.digest).toBe(sha256(bytes));
  const header = readSnapshotHeader(bytes);
  expect(header.gitCommit).toBe(writer);
  expect(header.gameID).toBe(gameId);
  expect(header.gameConfig.nationalMode).toBe(true);
  expect(header.tick).toBe(manifest.before.tick);
}

// Only called by the current reader. Mutations are adversarial inputs, not
// historical fixture generation.
async function rejectForgedReceipts(bytes: Uint8Array, oldWarId: string) {
  for (const change of [
    { recipientId: B },
    { actorId: "unknown-principal", recipientId: "unknown-principal" },
    { commandFingerprint: undefined },
    { warId: "unrecorded-war" },
    { warId: oldWarId },
    {
      commandFingerprint: JSON.stringify({
        kind: "declare-national",
        aggressorId: A,
        targetId: D,
      }),
    },
  ]) {
    const root = decodeSnapshotValue(bytes) as {
      game: {
        d: {
          nationalGovernance: {
            receipts: Record<string, unknown>[];
            results: Record<string, unknown>[];
          };
        };
      };
    };
    const journal = root.game.d.nationalGovernance;
    for (const records of [journal.receipts, journal.results]) {
      const receipt = records.find((r) => r.requestId === "c7e4-new-war");
      expect(receipt?.accepted).toBe(true);
      Object.assign(receipt!, change);
    }
    await expect(
      restoreTestGame(encodeSnapshotValue(root), "plains"),
    ).rejects.toThrow(/NATIONAL journal/);
  }
}

const mode = process.env.C7E4_MODE ?? "same-build";
test("C7 E4 pinned historical writer / independent consumer / same-build continuation", async () => {
  if (mode === "writer") {
    const writer = gitHead();
    expect(writers).toContain(writer);
    expect(writer).toBe(process.env.C7E4_WRITER);
    const m = await produce();
    const bytes = m.runner.snapshot(writer);
    const manifest: Manifest = {
      writer,
      driverSource: process.env.CURRENT_SHA!,
      driverDigest: sha256(
        readFileSync("tests/national/C7C1E4CrossBuild.test.ts"),
      ),
      gameRecordVersion: (decodeSnapshotValue(bytes) as { game: { v: number } })
        .game.v,
      node: process.version,
      npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
      run: process.env.GITHUB_RUN_ID!,
      attempt: process.env.GITHUB_RUN_ATTEMPT!,
      map: mapDigests(),
      digest: sha256(bytes),
      length: bytes.length,
      before: state(m.game),
    };
    expect(manifest.run).toMatch(/^\d+$/);
    expect(manifest.attempt).toMatch(/^\d+$/);
    verify(bytes, manifest, writer);
    const restored = attach(await restoreTestGame(bytes, "plains"));
    expect(restored.runner.snapshot(writer)).toEqual(bytes);
    expect(continueGame(restored)).toEqual(continueGame(m));
    expect(restored.runner.snapshot(writer)).toEqual(m.runner.snapshot(writer));
    const dir = process.env.C7E4_ARTIFACT_DIR!;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "snapshot.bin"), bytes);
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    console.info("C7E4_WRITER", JSON.stringify(manifest));
    return;
  }
  if (mode === "consumer") {
    for (const writer of writers) {
      const dir = join(process.env.C7E4_ARTIFACT_DIR!, writer);
      const bytes = new Uint8Array(readFileSync(join(dir, "snapshot.bin")));
      const manifest = JSON.parse(
        readFileSync(join(dir, "manifest.json"), "utf8"),
      ) as Manifest;
      verify(bytes, manifest, writer);
      const m = attach(await restoreTestGame(bytes, "plains"));
      expect(state(m.game)).toEqual(manifest.before);
      const duplicate = attach(await restoreTestGame(bytes, "plains"));
      const after = continueGame(m);
      expect(continueGame(duplicate)).toEqual(after);
      const current = gitHead();
      expect(current).toBe(manifest.driverSource);
      expect(m.runner.snapshot(current)).toEqual(
        duplicate.runner.snapshot(current),
      );
      expect(() =>
        verify(bytes, { ...manifest, writer: "" }, writer),
      ).toThrow();
      expect(() =>
        verify(bytes, { ...manifest, driverSource: "" }, writer),
      ).toThrow();
      expect(() => verify(bytes, { ...manifest, run: "0" }, writer)).toThrow();
      const corrupt = bytes.slice();
      corrupt[corrupt.length - 1] ^= 1;
      expect(() => verify(corrupt, manifest, writer)).toThrow();
      await expect(
        restoreTestGame(bytes.slice(0, -1), "plains"),
      ).rejects.toThrow();
      await expect(restoreTestGame(bytes, "world")).rejects.toThrow();
      const root = decodeSnapshotValue(bytes) as Record<string, unknown>;
      for (const format of [-1, 0, 999]) {
        await expect(
          restoreTestGame(encodeSnapshotValue({ ...root, format }), "plains"),
        ).rejects.toThrow();
      }
      await expect(
        restoreTestGame(
          encodeSnapshotValue({ ...root, tick: manifest.before.tick + 1 }),
          "plains",
        ),
      ).rejects.toThrow(/header tick/);
      await rejectForgedReceipts(
        m.runner.snapshot(current),
        manifest.before.layers[0].id,
      );
      console.info(
        "C7E4_CONSUMER",
        JSON.stringify({
          writer,
          current,
          digest: manifest.digest,
          before: manifest.before,
          after,
          currentDigest: sha256(m.runner.snapshot(current)),
        }),
      );
    }
    return;
  }
  expect(mode).toBe("same-build");
  const m = await produce();
  const bytes = m.runner.snapshot();
  const restored = attach(await restoreTestGame(bytes, "plains"));
  expect(state(restored.game)).toEqual(state(m.game));
  expect(restored.runner.snapshot()).toEqual(bytes);
  expect(continueGame(restored)).toEqual(continueGame(m));
  expect(restored.runner.snapshot()).toEqual(m.runner.snapshot());
}, 120_000);
