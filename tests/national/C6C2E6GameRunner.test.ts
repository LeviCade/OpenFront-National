import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { readNationalConfirmedVictory } from "@openfront/engine-api/game/NationalVictoryView";
import { readVersioned } from "@openfront/engine-lib/snapshot/SnapshotType";
import { GameSnapshot } from "@openfront/engine/game/GameImpl";
import { NationalOutboundFilter } from "@openfront/engine/national/observation/NationalOutbound";
import {
  evaluateUngovernable,
  METRIC_KEYS,
} from "@openfront/engine/national/politics/sovereignty";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readNationalPolitics } from "../../src/client/NationalDiplomacyState";
import {
  nationalVictoryAt,
  nationalVictoryPresentation,
} from "../../src/client/NationalVictoryExperience";
import {
  parseTrustedNationalProjection,
  materializeTrustedNationalUpdate,
} from "../../src/client/TrustedNationalSession";
import { encodeNationalRecipientProjection } from "../../src/server/national/NationalRecipientWire";
import { roundTrip } from "../util/Snapshot";
import { A, B, C, EMPIRE, I, infos, scenario } from "./C6C2E6Scenario";

describe("Sixth Conductor Second Class E6 GameRunner endgame", () => {
  it("strict warning, rejected outsider transfer, real succession and eight awards from the committed WIN", async () => {
    const m = await scenario();
    const warning = m.game.nationalUngovernableWarnings()[0];
    expect(warning.remainingMs).toBeGreaterThan(0);
    expect(warning.remainingMs).toBeLessThanOrEqual(10_000);
    expect(m.packet().nationalPolitics?.victory).toBeNull();
    const before = m.packet();
    const poisoned = {
      ...before,
      nationalPolitics: {
        ...before.nationalPolitics!,
        victory: {
          resolved: true,
          sovereignPowerCount: 1,
          confirmedTick: before.tick,
          prizes: [{ kind: "SovereignVictor" as const, nationId: A }],
        },
      },
    };
    expect(
      new NationalOutboundFilter(m.game, null).project(m.game, poisoned, null)
        .nationalPolitics?.victory,
    ).toBeNull();
    const politics = readVersioned(GameSnapshot, snapshotGameData(m.game).game)
      .national!.politics;
    for (const metric of METRIC_KEYS) {
      const tied = structuredClone(politics);
      const ruler = tied.nations.find((n) => n.id === A)!;
      const member = tied.nations.find((n) => n.id === B)!;
      expect(ruler.metrics[metric]).toBeLessThan(member.metrics[metric]);
      member.metrics[metric] = ruler.metrics[metric];
      expect(evaluateUngovernable(tied, tied.simulationMs).warnings).toEqual(
        [],
      );
    }
    m.transfer(I, B, "e6-unauthorized");
    expect(m.game.nationalPoliticalAuthority()?.emperorOf(EMPIRE)).toBe(A);
    expect(
      m.game
        .nationalPoliticalCommandResults(m.game.player(I))
        .find((r) => r.requestId === "e6-unauthorized")?.accepted,
    ).toBe(false);
    m.transfer(A, B);
    expect(m.game.nationalPoliticalAuthority()?.emperorOf(EMPIRE)).toBe(B);
    expect(m.game.nationalUngovernableWarnings()).toEqual([]);
    const recipient = m.registerRecipient(B);
    const packet = m.conquer();
    expect(recipient.packet().nationalPolitics?.victory).toEqual(
      packet.nationalPolitics?.victory,
    );
    const recipientWire = encodeNationalRecipientProjection(recipient.packet());
    const recipientDecoded = materializeTrustedNationalUpdate(
      parseTrustedNationalProjection(recipientWire, packet.tick),
      packet.tick - 1,
    );
    expect(recipientDecoded.nationalPolitics?.victory).toEqual(
      packet.nationalPolitics?.victory,
    );
    expect(recipientWire).not.toContain("allPlayersStats");
    expect(m.wins[0].winner).toEqual(["player", infos[1].clientID]);
    const victory = nationalVictoryAt(
      readNationalPolitics(packet.nationalPolitics),
      packet.tick,
      packet.tick,
    )!;
    expect(victory).not.toBeNull();
    expect(victory.prizes).toHaveLength(8);
    const wire = encodeNationalRecipientProjection(packet);
    const decoded = materializeTrustedNationalUpdate(
      parseTrustedNationalProjection(wire, packet.tick),
      packet.tick - 1,
    );
    expect(decoded.nationalPolitics?.victory).toEqual(victory);
    expect(decoded.updates[GameUpdateType.Win]).toEqual([]);
    expect(wire).not.toContain("allPlayersStats");
    expect(wire).not.toContain("nationalPactDisclosure");
    expect(() =>
      encodeNationalRecipientProjection({
        ...packet,
        nationalPolitics: {
          ...packet.nationalPolitics!,
          victory: { ...victory, confirmedTick: packet.tick + 1 },
        },
      }),
    ).toThrow(/public politics/);
    for (const p of infos.slice(0, 8)) {
      const view = nationalVictoryPresentation(victory, p.id, (id) => id);
      expect(view.award).toBe(p.id === B ? "ImperialVictor" : "EmpireVictor");
      expect(view.won).toBe(true);
    }
    expect(nationalVictoryPresentation(victory, I, (id) => id).won).toBe(false);
    const restored = await roundTrip(m.game, "plains");
    expect(restored.restored.nationalPublicPoliticalView()?.victory).toEqual(
      victory,
    );
    expect([...restored.again]).toEqual([...restored.bytes]);
    console.info(
      "C6C2-E6-SOVEREIGN-ENDGAME",
      JSON.stringify({
        warning,
        confirmedTick: victory.confirmedTick,
        awards: victory.prizes,
        rawWinner: m.wins[0].winner,
        unclaimed:
          m.game.numLandTiles() -
          m.game.players().reduce((sum, p) => sum + p.numTilesOwned(), 0),
        players: m.game.players().map((p) => ({
          id: p.id(),
          tiles: p.numTilesOwned(),
          troops: p.troops(),
          gold: String(p.gold()),
        })),
        snapshotSha256: createHash("sha256")
          .update(restored.bytes)
          .digest("hex"),
        restoredSha256: createHash("sha256")
          .update(restored.again)
          .digest("hex"),
      }),
    );
    const forged = { ...victory, confirmedTick: packet.tick + 1 };
    expect(readNationalConfirmedVictory(forged, packet.tick)).toBeNull();
  }, 120_000);

  it("independent sovereign wins on actual WIN with unclaimed land", async () => {
    const m = await scenario(true);
    const packet = m.conquer();
    expect(m.wins[0].winner).toEqual(["player", infos[1].clientID]);
    expect(packet.nationalPolitics?.victory?.prizes).toEqual([
      { kind: "SovereignVictor", nationId: B },
    ]);
  }, 120_000);

  it("expired deadline dissolves real empire without WIN", async () => {
    const m = await scenario();
    const deadline = m.game.nationalUngovernableWarnings()[0].deadlineMs;
    while (m.game.ticks() * 100 < deadline + 100) m.tick();
    expect(m.game.nationalPoliticalAuthority()?.empireExists(EMPIRE)).toBe(
      false,
    );
    for (const id of [A, B, C])
      expect(m.game.nationalPoliticalAuthority()?.empireOf(id)).toBeNull();
    expect(m.game.getWinner()).toBeNull();
    expect(m.wins).toEqual([]);
    expect(m.packet().nationalPolitics?.victory).toBeNull();
    m.transfer(A, B, "e6-late");
    expect(m.game.nationalPoliticalAuthority()?.empireExists(EMPIRE)).toBe(
      false,
    );
    expect(
      m.game
        .nationalPoliticalCommandResults(m.game.player(A))
        .find((r) => r.requestId === "e6-late")?.accepted,
    ).toBe(false);
    expect(m.wins).toEqual([]);
  }, 120_000);
});
