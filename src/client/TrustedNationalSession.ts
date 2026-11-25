import type { GameUpdates } from "@openfront/engine-api/game/GameTypes";
import { validateNationalAssessmentPacket } from "@openfront/engine-api/game/NationalAssessmentView";
import { validateNationalImperialPacket } from "@openfront/engine-api/game/NationalImperialView";
import { validateNationalPactPacket } from "@openfront/engine-api/game/NationalPactView";
import type { NationalObserverMapV1 } from "@openfront/engine-api/game/NationalRecipientView";
import { validateNationalSettlementPacket } from "@openfront/engine-api/game/NationalSettlementView";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { simpleHash } from "@openfront/engine-lib/Util";
import { decodeNationalObserverNativeUnits } from "@openfront/shared/NationalObserverNativeWire";
/**
 * Reader for E3's authenticated per-recipient NATIONAL view ONLY.
 * This module never runs a GameRunner, simulates turns or loads private state.
 */
import {
  GameUpdateType,
  type GameUpdateViewData,
} from "@openfront/engine-api/game/GameUpdates";
import type { GameEvent } from "@openfront/shared/EventBus";
import type { ServerNationalStartMessage } from "@openfront/shared/WireSchemas";

const allowedFields = new Set([
  "tick",
  "updates",
  "packedTileUpdates",
  "packedUnitUpdates",
  "packedMissileTimers",
  "packedPlayerUpdates",
  "playerNameViewData",
  "nationalPolitics",
  "nationalConflicts",
  "nationalCommandResults",
  "nationalAccessionOffers",
  "nationalPactDisclosure",
  "nationalImperialAdministration",
  "nationalAssessments",
  "nationalSettlements",
  "nationalObserverMap",
]);
const permittedUpdates = new Set<number>([
  GameUpdateType.Player,
  GameUpdateType.GamePaused,
  GameUpdateType.SpawnPhaseEnd,
]);

export interface TrustedNationalProjection {
  readonly tick: number;
  readonly [key: string]: unknown;
}

/** E3 / C2 authenticated visible map page, never a Game snapshot. */
export type TrustedNationalObserverMap = NationalObserverMapV1;

/** Do not unlock Private NATIONAL until the final authorized map page arrives. */
export function completedTrustedObserverMap(
  page: Pick<TrustedNationalObserverMap, "observerId" | "nextCursor"> | null,
  actorId: string | null,
): boolean {
  return (
    page !== null &&
    actorId !== null &&
    page.observerId === actorId &&
    page.nextCursor === null
  );
}

const safeInteger = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const safeNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * Reject invalid/oversized E3 map pages before any state reaches the GPU.
 * Ownership is NEVER inferred for tiles omitted from the authorized page.
 */
export function readTrustedNationalObserverMap(
  value: unknown,
  packetTick: number,
): TrustedNationalObserverMap | null {
  if (value === undefined) return null;
  if (!record(value)) throw new Error("NATIONAL observer-map is not a record");
  const maxMapTiles = 32_000_000;
  const width = value.width;
  const height = value.height;
  if (
    value.version !== 1 ||
    value.tick !== packetTick ||
    typeof value.observerId !== "string" ||
    value.observerId.length === 0 ||
    value.observerId.length > 128 ||
    !safeInteger(width, 1, 16_384) ||
    !safeInteger(height, 1, 16_384) ||
    width * height > maxMapTiles ||
    typeof value.reset !== "boolean" ||
    !safeInteger(value.cursor, 0, maxMapTiles) ||
    (value.nextCursor !== null &&
      (!safeInteger(value.nextCursor, 0, maxMapTiles) ||
        value.nextCursor < value.cursor)) ||
    !Array.isArray(value.tiles) ||
    value.tiles.length > 4096 ||
    !Array.isArray(value.units) ||
    value.units.length > 2048 ||
    typeof value.unitsTruncated !== "boolean" ||
    !Array.isArray(value.visibleBorders) ||
    value.visibleBorders.length > 4096 ||
    !record(value.ownResources) ||
    !safeNumber(value.ownResources.troops) ||
    !safeNumber(value.ownResources.treasury) ||
    !Array.isArray(value.countries) ||
    value.countries.length > 4096
  )
    throw new Error("NATIONAL invalid observer-map v1 metadata");
  const validTile = (ref: unknown) => safeInteger(ref, 0, width * height - 1);
  let lastRef = -1;
  for (const tuple of value.tiles as unknown[]) {
    if (
      !Array.isArray(tuple) ||
      tuple.length !== 4 ||
      !validTile(tuple[0]) ||
      tuple[0] <= lastRef ||
      !safeInteger(tuple[1], 0, 65535) ||
      !safeInteger(tuple[2], 0, 255) ||
      !safeInteger(tuple[3], 0, 15)
    )
      throw new Error("NATIONAL invalid visible tile page");
    lastRef = tuple[0];
  }
  for (const unit of value.units as unknown[]) {
    if (
      !record(unit) ||
      !safeInteger(unit.id, 0, 0xffffffff) ||
      typeof unit.ownerId !== "string" ||
      unit.ownerId.length > 128 ||
      typeof unit.kind !== "string" ||
      unit.kind.length > 64 ||
      !validTile(unit.tile) ||
      (unit.troops !== undefined && !safeNumber(unit.troops))
    )
      throw new Error("NATIONAL invalid visible unit marker");
  }
  for (const border of value.visibleBorders as unknown[]) {
    if (
      !record(border) ||
      typeof border.targetId !== "string" ||
      border.targetId.length > 128 ||
      (border.access !== "land" && border.access !== "naval")
    )
      throw new Error("NATIONAL invalid visible border");
  }
  for (const country of value.countries as unknown[]) {
    if (
      !record(country) ||
      typeof country.id !== "string" ||
      country.id.length > 128 ||
      typeof country.name !== "string" ||
      country.name.length > 256 ||
      typeof country.alive !== "boolean" ||
      !safeNumber(country.landPercent) ||
      typeof country.status !== "string" ||
      country.status.length > 64
    )
      throw new Error("NATIONAL invalid public country");
  }
  return value as unknown as TrustedNationalObserverMap;
}

/** Exactly E3's currently-visible terrain+ownership lanes. */
export function observerMapTilePairs(
  observerMap: TrustedNationalObserverMap | null,
): number[] {
  if (observerMap === null) return [];
  const pairs: number[] = [];
  for (const [tile, state, terrain] of observerMap.tiles) {
    pairs.push(tile, state | (terrain << 16));
  }
  return pairs;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numericArray(
  value: unknown,
  maxItems: number,
  unsigned = false,
): number[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > maxItems ||
    !value.every(
      (v) =>
        typeof v === "number" &&
        Number.isFinite(v) &&
        (!unsigned || (Number.isSafeInteger(v) && v >= 0 && v <= 0xffffffff)),
    )
  ) {
    throw new Error("NATIONAL invalid projected numeric lanes");
  }
  return value as number[];
}

export function parseTrustedNationalProjection(
  payload: string,
  expectedTick: number,
): TrustedNationalProjection {
  if (payload.length > 2_000_000)
    throw new Error("NATIONAL oversized projection");
  const parsed: unknown = JSON.parse(payload);
  if (
    !record(parsed) ||
    !Number.isSafeInteger(expectedTick) ||
    expectedTick < 0 ||
    parsed.tick !== expectedTick ||
    !Object.keys(parsed).every((key) => allowedFields.has(key)) ||
    !Array.isArray(parsed.packedTileUpdates) ||
    !record(parsed.updates) ||
    !Object.entries(parsed.updates).every(
      ([key, entries]) =>
        permittedUpdates.has(Number(key)) && Array.isArray(entries),
    )
  ) {
    throw new Error("NATIONAL invalid recipient projection");
  }
  const map = record(parsed.nationalObserverMap)
    ? parsed.nationalObserverMap
    : null;
  validateNationalSettlementPacket(
    parsed.nationalSettlements,
    typeof map?.observerId === "string" ? map.observerId : null,
    expectedTick,
    typeof map?.streamId === "string" ? map.streamId : undefined,
  );
  validateNationalAssessmentPacket(
    parsed.nationalAssessments,
    typeof map?.observerId === "string" ? map.observerId : null,
    expectedTick,
  );
  return parsed as TrustedNationalProjection;
}

/**
 * Materialize numeric lanes and empty enum buckets required by the existing
 * GameView/WebGL renderer. Empty buckets represent NO E3-delivered update;
 * they never recreate unseen opponent data or local simulation.
 *
 * Reject mismatched ticks, backward/replayed projections and invalid lanes.
 */
/** E3 intentionally omits the private map for unspawned or eliminated seats.
 * This restricted public frame MUST NOT authorize a private map or commands. */
export function assertTrustedPublicProjection(
  packet: TrustedNationalProjection,
  actor?: string,
  clientID?: string,
): void {
  if (
    packet.nationalObserverMap !== undefined ||
    !Array.isArray(packet.packedTileUpdates) ||
    packet.packedTileUpdates.length !== 0 ||
    [
      "packedUnitUpdates",
      "packedPlayerUpdates",
      "packedMissileTimers",
      "playerNameViewData",
      "nationalCommandResults",
      "nationalAccessionOffers",
      "nationalPactDisclosure",
      "nationalImperialAdministration",
      "nationalAssessments",
      "nationalSettlements",
    ].some((key) => packet[key] !== undefined) ||
    !record(packet.updates)
  )
    throw new Error("NATIONAL unauthorized public-only projection");
  validateNationalPactPacket(
    packet.nationalPolitics,
    packet.nationalPactDisclosure,
    null,
    packet.tick,
  );
  const allowed = new Set([
    "type",
    "id",
    "name",
    "displayName",
    "nationFlag",
    "playerType",
    "smallID",
    "isAlive",
    "tilesOwned",
  ]);
  const players = packet.updates[GameUpdateType.Player];
  const seen = new Set<string>();
  if (!Array.isArray(players))
    throw new Error("NATIONAL malformed public roster");
  for (const player of players) {
    if (
      !record(player) ||
      player.type !== GameUpdateType.Player ||
      typeof player.id !== "string" ||
      seen.has(player.id)
    )
      throw new Error("NATIONAL invalid public roster");
    seen.add(player.id);
    const ownIdentity =
      actor !== undefined &&
      clientID !== undefined &&
      player.id === actor &&
      player.clientID === clientID;
    if (
      Object.keys(player).some(
        (key) =>
          !allowed.has(key) &&
          !(ownIdentity && (key === "clientID" || key === "hasSpawned")),
      ) ||
      (ownIdentity && typeof player.hasSpawned !== "boolean")
    )
      throw new Error(
        "NATIONAL public roster contains unauthorized player fields",
      );
  }
  const conflict = packet.nationalConflicts;
  if (
    conflict !== undefined &&
    (!record(conflict) ||
      conflict.recipientId !== "" ||
      !Array.isArray(conflict.motions) ||
      conflict.motions.length !== 0)
  )
    throw new Error("NATIONAL private conflict data without active sight");
}

/** Only the explicit E1 public terminal result may be displayed as victory. */
export function readTrustedVictory(
  packet: TrustedNationalProjection,
  actor: string,
): "victory" | "defeat" | "unresolved" {
  const politics = packet.nationalPolitics;
  if (!record(politics) || !record(politics.victory)) return "unresolved";
  const victory = politics.victory;
  if (
    victory.resolved !== true ||
    victory.sovereignPowerCount !== 1 ||
    !Array.isArray(victory.prizes) ||
    !victory.prizes.length ||
    victory.prizes.some(
      (p) =>
        !record(p) ||
        typeof p.nationId !== "string" ||
        (p.kind !== "SovereignVictor" &&
          p.kind !== "ImperialVictor" &&
          p.kind !== "EmpireVictor") ||
        (p.kind !== "SovereignVictor" && typeof p.empireId !== "string"),
    )
  )
    return "unresolved";
  return victory.prizes.some((p) => p.nationId === actor)
    ? "victory"
    : "defeat";
}

export function materializeTrustedNationalUpdate(
  packet: TrustedNationalProjection,
  previousTick: number,
): GameUpdateViewData {
  if (
    !Number.isSafeInteger(packet.tick) ||
    packet.tick < 0 ||
    packet.tick <= previousTick ||
    !record(packet.updates)
  ) {
    throw new Error("NATIONAL stale or malformed projected tick");
  }
  const safeUpdates = Array.from(
    { length: GameUpdateType.DonateEvent + 1 },
    () => [],
  ) as unknown as GameUpdates;
  for (const [key, entries] of Object.entries(packet.updates)) {
    const index = Number(key);
    if (!permittedUpdates.has(index) || !Array.isArray(entries)) {
      throw new Error("NATIONAL unauthorized engine update bucket");
    }
    (safeUpdates as unknown as Record<number, unknown[]>)[index] = entries;
  }

  const tiles = numericArray(packet.packedTileUpdates, 1_048_576, true);
  if (tiles === undefined || tiles.length % 2 !== 0)
    throw new Error("NATIONAL invalid projected tile pairs");
  const observerMap = readTrustedNationalObserverMap(
    packet.nationalObserverMap,
    packet.tick,
  );
  // The caller checks page principal/epoch with NationalObserverMapContinuity.
  // Independently reject malformed or cross-epoch pact sibling lanes here.
  validateNationalPactPacket(
    packet.nationalPolitics,
    packet.nationalPactDisclosure,
    observerMap?.observerId ?? null,
    packet.tick,
    observerMap?.streamId,
  );
  validateNationalImperialPacket(
    packet.nationalImperialAdministration,
    packet.nationalPolitics,
    observerMap?.observerId ?? null,
    packet.tick,
    observerMap?.streamId,
  );
  // E3's paged current-sight map gives late joiners real visible territory.
  // All added states belong to the authenticated observer's current sight.
  const visibleTilePairs = [...tiles, ...observerMapTilePairs(observerMap)];
  validateNationalSettlementPacket(
    packet.nationalSettlements,
    observerMap?.observerId ?? null,
    packet.tick,
    observerMap?.streamId,
  );
  validateNationalAssessmentPacket(
    packet.nationalAssessments,
    observerMap?.observerId ?? null,
    packet.tick,
  );
  const units = decodeNationalObserverNativeUnits(packet.packedUnitUpdates);
  const players = numericArray(packet.packedPlayerUpdates, 25_000);
  if (players !== undefined && players.length % 5 !== 0)
    throw new Error("NATIONAL invalid projected player stride");
  const missiles = numericArray(packet.packedMissileTimers, 80_000, true);

  return {
    tick: packet.tick,
    updates: safeUpdates,
    packedTileUpdates: Uint32Array.from(visibleTilePairs),
    ...(units === undefined ? {} : { packedUnitUpdates: units }),
    ...(players === undefined
      ? {}
      : { packedPlayerUpdates: Float64Array.from(players) }),
    ...(missiles === undefined
      ? {}
      : { packedMissileTimers: Uint32Array.from(missiles) }),
    ...(packet.playerNameViewData === undefined
      ? {}
      : { playerNameViewData: packet.playerNameViewData }),
    ...(packet.nationalPolitics === undefined
      ? {}
      : { nationalPolitics: packet.nationalPolitics }),
    ...(packet.nationalConflicts === undefined
      ? {}
      : { nationalConflicts: packet.nationalConflicts }),
    ...(packet.nationalCommandResults === undefined
      ? {}
      : { nationalCommandResults: packet.nationalCommandResults }),
    ...(packet.nationalImperialAdministration === undefined
      ? {}
      : {
          nationalImperialAdministration: packet.nationalImperialAdministration,
        }),
    ...(packet.nationalPactDisclosure === undefined
      ? {}
      : { nationalPactDisclosure: packet.nationalPactDisclosure }),
    ...(packet.nationalAccessionOffers === undefined
      ? {}
      : { nationalAccessionOffers: packet.nationalAccessionOffers }),
    ...(packet.nationalSettlements === undefined
      ? {}
      : { nationalSettlements: packet.nationalSettlements }),
    ...(packet.nationalAssessments === undefined
      ? {}
      : { nationalAssessments: packet.nationalAssessments }),
  } as GameUpdateViewData;
}

/** Same deterministic human ID derivation as createGameRunnerInternal. Never read the observerId from a projection to select a principal. */
export function trustedNationalPrincipal(
  start: ServerNationalStartMessage,
): string {
  const random = new PseudoRandom(simpleHash(start.gameStartInfo.gameID));
  let principal: string | null = null;
  for (const player of start.gameStartInfo.players) {
    const id = random.nextID();
    if (player.clientID !== start.myClientID) continue;
    if (principal !== null) throw new Error("NATIONAL duplicate admitted seat");
    principal = id;
  }
  if (principal === null) throw new Error("NATIONAL missing admitted seat");
  return principal;
}

export class TrustedNationalStartedEvent implements GameEvent {
  constructor(public readonly start: ServerNationalStartMessage) {}
}

/** Close native menus holding coordinates and requests from an expired sight lease. */
export class TrustedNationalSightRevokedEvent implements GameEvent {}

/** Dismiss menu actions computed against superseded political facts. */
export class NationalPoliticalAffordanceChangedEvent implements GameEvent {}

export class TrustedNationalProjectionEvent implements GameEvent {
  constructor(public readonly projection: TrustedNationalProjection) {}
}

/** The authenticated wire carried a malformed projection. Fail closed, not silent. */
export class TrustedNationalProjectionRejectedEvent implements GameEvent {
  constructor(public readonly gameID: string) {}
}
