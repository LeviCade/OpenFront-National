/**
 * Shared native companion-lane validator for the public recipient DTO.
 * Private geometry derives only from the authorized page. The binary native
 * representation must agree with it; it may not create a second sight path.
 * No simulation imports; used on both trusted host and browser.
 */
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import {
  NATIONAL_OBSERVER_MAX_UNITS,
  type NationalObserverMapV1,
} from "@openfront/engine-api/game/NationalRecipientView";
import {
  OFFSET_HEALTH,
  OFFSET_ID,
  OFFSET_LAST_POS,
  OFFSET_LEVEL,
  OFFSET_MARKED_FOR_DELETION,
  OFFSET_NUKE_WAIT_TICKS,
  OFFSET_PACKED_A,
  OFFSET_PACKED_B,
  OFFSET_POS,
  OFFSET_SAM_UPGRADE_DURATION,
  OFFSET_SAM_UPGRADE_START_RANGE,
  OFFSET_SAM_UPGRADE_START_TICK,
  OFFSET_SAM_UPGRADE_TARGET_LEVEL,
  OFFSET_TARGET_TILE,
  OFFSET_TARGET_UNIT_ID,
  OFFSET_TRANSPORT_TROOPS,
  OFFSET_TROOPS,
  OFFSET_WARSHIP_LAST_COMBAT_TICK,
  OFFSET_WARSHIP_PATROL_TILE,
  OFFSET_WARSHIP_RETREAT_PORT,
  OFFSET_WARSHIP_VETERANCY_PROGRESS,
  UNIT_UPDATE_STRIDE,
  unpackALastOwnerID,
  unpackAOwnerID,
  unpackAUnitType,
} from "@openfront/engine-lib/game/PackedUnitUpdates";

const optional = new Set([
  OFFSET_HEALTH,
  OFFSET_TARGET_TILE,
  OFFSET_TARGET_UNIT_ID,
  OFFSET_MARKED_FOR_DELETION,
  OFFSET_WARSHIP_PATROL_TILE,
  OFFSET_WARSHIP_RETREAT_PORT,
  OFFSET_SAM_UPGRADE_START_TICK,
  OFFSET_SAM_UPGRADE_DURATION,
  OFFSET_SAM_UPGRADE_START_RANGE,
  OFFSET_SAM_UPGRADE_TARGET_LEVEL,
]);
const privateAbsent = [
  OFFSET_HEALTH,
  OFFSET_TARGET_TILE,
  OFFSET_TARGET_UNIT_ID,
  OFFSET_WARSHIP_PATROL_TILE,
  OFFSET_WARSHIP_RETREAT_PORT,
];
const privateZero = [
  OFFSET_WARSHIP_LAST_COMBAT_TICK,
  OFFSET_WARSHIP_VETERANCY_PROGRESS,
  OFFSET_SAM_UPGRADE_START_TICK,
  OFFSET_SAM_UPGRADE_DURATION,
  OFFSET_SAM_UPGRADE_START_RANGE,
  OFFSET_SAM_UPGRADE_TARGET_LEVEL,
  OFFSET_TRANSPORT_TROOPS,
  OFFSET_NUKE_WAIT_TICKS,
  OFFSET_LEVEL,
];

function invalid(): never {
  throw new Error("NATIONAL invalid native recipient lane");
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sequence(value: unknown): readonly unknown[] | Float64Array | Uint32Array {
  if (Array.isArray(value) || value instanceof Float64Array || value instanceof Uint32Array)
    return value;
  return invalid();
}

function uint(value: unknown, max = 0xffffffff): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

/** JSON null represents NaN only at the public codec's optional offsets. */
export function decodeNationalObserverNativeUnits(value: unknown): Float64Array | undefined {
  if (value === undefined) return undefined;
  const input = sequence(value);
  if (input.length > NATIONAL_OBSERVER_MAX_UNITS * UNIT_UPDATE_STRIDE ||
    input.length % UNIT_UPDATE_STRIDE !== 0) invalid();
  const output = value instanceof Float64Array ? value : new Float64Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const cell = input[i];
    if ((cell === null || (typeof cell === "number" && Number.isNaN(cell))) &&
      optional.has(i % UNIT_UPDATE_STRIDE)) {
      output[i] = NaN;
    } else if (typeof cell === "number" && Number.isFinite(cell)) {
      output[i] = cell;
    } else invalid();
  }
  return output;
}

interface NativeLanes {
  readonly tick?: unknown;
  readonly packedTileUpdates?: unknown;
  readonly packedUnitUpdates?: unknown;
  readonly packedMissileTimers?: unknown;
  readonly packedPlayerUpdates?: unknown;
  readonly playerNameViewData?: unknown;
  readonly updates?: unknown;
  readonly nationalPolitics?: unknown;
  readonly nationalConflicts?: unknown;
  readonly nationalAccessionOffers?: unknown;
  readonly nationalCommandResults?: unknown;
}

const foreignPlayerFields = new Set([
  "type", "id", "name", "displayName", "nationFlag", "playerType",
  "smallID", "isAlive", "tilesOwned",
]);

/** Checks recipient scope, permitted native coordinates, private field
 * sentinels, and lane strides BEFORE client reconciliation or serialization.
 * A malicious authenticated host can still invent mutually consistent facts;
 * authority and authenticity remain E2's socket and E3's current Game.
 */
export function validateNationalObserverNativeLanes(
  packet: NativeLanes,
  page: NationalObserverMapV1,
): Float64Array | undefined {
  if (!uint(page.observerSmallId, 0xfff) || sequence(packet.packedTileUpdates).length !== 0)
    invalid();
  const native = decodeNationalObserverNativeUnits(packet.packedUnitUpdates);
  if ((native?.length ?? 0) !== page.units.length * UNIT_UPDATE_STRIDE) invalid();
  const shared = new Set<string>([page.observerId]);
  if (packet.nationalPolitics !== undefined) {
    if (!record(packet.nationalPolitics) || !Array.isArray(packet.nationalPolitics.empires)) invalid();
    for (const empire of packet.nationalPolitics.empires) {
      if (!record(empire) || !Array.isArray(empire.memberIds) ||
        typeof empire.leaderId !== "string" || !empire.memberIds.every((id: unknown) => typeof id === "string"))
        invalid();
      if (empire.leaderId === page.observerId || empire.memberIds.includes(page.observerId)) {
        shared.add(empire.leaderId);
        for (const id of empire.memberIds) shared.add(id);
      }
    }
  }
  const ownUnits = new Set<number>();
  for (let i = 0; i < page.units.length; i++) {
    const marker = page.units[i];
    const row = native!.subarray(i * UNIT_UPDATE_STRIDE, (i + 1) * UNIT_UPDATE_STRIDE);
    const a = row[OFFSET_PACKED_A];
    const own = marker.ownerId === page.observerId;
    if (!uint(a, 0x1fffffff) ||
      !uint(marker.nativeOwnerSmallId, 0xfff) ||
      row[OFFSET_ID] !== marker.id || row[OFFSET_POS] !== marker.tile ||
      unpackAOwnerID(a) !== marker.nativeOwnerSmallId ||
      unpackAUnitType(a) !== marker.nativeType ||
      (own && marker.nativeOwnerSmallId !== page.observerSmallId) ||
      row[OFFSET_TROOPS] < 0 ||
      (!Number.isNaN(row[OFFSET_MARKED_FOR_DELETION]) && !uint(row[OFFSET_MARKED_FOR_DELETION])))
      invalid();
    if (own) {
      if (marker.troops !== undefined && row[OFFSET_TROOPS] !== marker.troops) invalid();
      ownUnits.add(marker.id);
    } else if (
      row[OFFSET_LAST_POS] !== marker.tile ||
      (!shared.has(marker.ownerId) && row[OFFSET_TROOPS] !== 0) ||
      unpackALastOwnerID(a) !== undefined ||
      (row[OFFSET_PACKED_B] !== 0 && row[OFFSET_PACKED_B] !== 256) ||
      privateAbsent.some((offset) => !Number.isNaN(row[offset])) ||
      privateZero.some((offset) => row[offset] !== 0)
    ) invalid();
  }
  if (packet.packedMissileTimers !== undefined) {
    const timers = sequence(packet.packedMissileTimers);
    if (timers.length > 80_000) invalid();
    const seen = new Set<number>();
    for (let i = 0; i < timers.length;) {
      const id = timers[i++];
      const length = timers[i++];
      if (!uint(id) || !ownUnits.has(id) || seen.has(id) ||
        !uint(length, timers.length - i)) invalid();
      seen.add(id);
      for (let end = i + length; i < end; i++) if (!uint(timers[i])) invalid();
    }
  }
  if (packet.packedPlayerUpdates !== undefined) {
    const players = sequence(packet.packedPlayerUpdates);
    if (players.length > 25_000 || players.length % 5 !== 0) invalid();
    for (let i = 0; i < players.length; i++) {
      const value = players[i];
      if (typeof value !== "number" || !Number.isFinite(value) ||
        (i % 5 === 0 && value !== page.observerSmallId)) invalid();
    }
  }
  if (packet.playerNameViewData !== undefined &&
    (!record(packet.playerNameViewData) ||
      Object.keys(packet.playerNameViewData).some((id) => id !== page.observerId)))
    invalid();
  if (!record(packet.updates)) invalid();
  const players = packet.updates[GameUpdateType.Player];
  if (!Array.isArray(players)) invalid();
  for (const player of players) {
    if (!record(player) || typeof player.id !== "string" ||
      (player.id !== page.observerId &&
        Object.keys(player).some((field) => !foreignPlayerFields.has(field))))
      invalid();
  }
  for (const dto of [packet.nationalConflicts, packet.nationalAccessionOffers]) {
    if (dto !== undefined && (!record(dto) || dto.recipientId !== page.observerId)) invalid();
  }
  if (packet.nationalCommandResults !== undefined &&
    (!Array.isArray(packet.nationalCommandResults) ||
      packet.nationalCommandResults.some((receipt: unknown) =>
        !record(receipt) || receipt.actorId !== page.observerId ||
        receipt.recipientId !== page.observerId)))
    invalid();
  return native;
}
