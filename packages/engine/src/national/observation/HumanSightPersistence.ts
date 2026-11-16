/**
 * E3 adapter to E1's canonical, per-player GameSnapshot sight-memory port.
 * This module does NOT own a separate store or versioned Game state.
 *
 * A missing pre-integration E1 port returns no prior sightings: never
 * reconstruct hidden history from current authoritative enemy locations.
 * Both operations use the GameRunner's authenticated principal, not a
 * requester-supplied observation ID or a client-provided memory payload.
 */
import type { Game } from "../../game/Game";
import type { NationalSightMemory } from "./NationalObservation";

interface NationalHumanSightGamePort {
  readNationalObserverMemory(playerId: string): NationalSightMemory | null;
  writeNationalObserverMemory(
    playerId: string,
    memory: NationalSightMemory | null,
  ): void;
}

function readPort(game: Game): NationalHumanSightGamePort | null {
  const candidate = game as Game & Partial<NationalHumanSightGamePort>;
  return typeof candidate.readNationalObserverMemory === "function" &&
    typeof candidate.writeNationalObserverMemory === "function"
    ? (candidate as NationalHumanSightGamePort)
    : null;
}

/** Returns a detached, identity-verified record from E1's actual Game state. */
export function restoreNationalHumanSight(
  game: Game,
  principalId: string,
): NationalSightMemory | null {
  const stored = readPort(game)?.readNationalObserverMemory(principalId);
  if (stored === undefined || stored === null) return null;
  if (stored.observerId !== principalId) {
    throw new Error("NATIONAL restored sight principal mismatch");
  }
  return {
    observerId: stored.observerId,
    assets: stored.assets.map((asset) => ({ ...asset })),
  };
}

/** Only a real principal's current, verified history may enter GameSnapshot. */
export function persistNationalHumanSight(
  game: Game,
  principalId: string,
  memory: NationalSightMemory | null,
): void {
  const port = readPort(game);
  if (port === null) return;
  if (memory !== null && memory.observerId !== principalId) {
    throw new Error("NATIONAL persisted sight principal mismatch");
  }
  port.writeNationalObserverMemory(
    principalId,
    memory === null
      ? null
      : {
          observerId: memory.observerId,
          assets: memory.assets.map((asset) => ({ ...asset })),
        },
  );
}
