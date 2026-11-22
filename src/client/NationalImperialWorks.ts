import {
  Structures,
  type UnitType,
} from "@openfront/engine-api/game/GameTypes";
import type { NationalImperialAdministrationView } from "@openfront/engine-api/game/NationalImperialView";
import type { GameView } from "./view";

/** A real, currently rendered structure owned by a current imperial member. */
export interface ImperialStructureChoice {
  readonly memberId: string;
  readonly unitId: number;
  readonly label: string;
}

/**
 * The emperor may only SELECT units already disclosed by the ordinary
 * GameView and a matching current member-only imperial projection.
 * No enemy units, hidden world scans, or forged tile/unit identifiers.
 * This is an affordance, never a substitute for execution-time authority.
 */
export function imperialStructureChoices(
  game: GameView,
  view: NationalImperialAdministrationView,
): readonly ImperialStructureChoice[] {
  const actor = game.myPlayer();
  const politics = game.nationalPolitics();
  if (
    !view.canAmend ||
    !actor?.isAlive() ||
    game.isSpectator() ||
    game.config().isReplay() ||
    game.inSpawnPhase() ||
    game.nationalPoliticsTick() !== game.ticks()
  )
    return [];
  const empire = politics?.empires.find(
    (item) => item.id === view.empireId && item.leaderId === actor.id(),
  );
  if (!empire || !empire.memberIds.includes(actor.id())) return [];

  const members = new Set(empire.memberIds);
  const structureTypes = new Set<UnitType>(Structures.types);
  const choices: ImperialStructureChoice[] = [];
  for (const player of game.players()) {
    if (
      !members.has(player.id()) ||
      !player.isAlive() ||
      typeof player.units !== "function"
    )
      continue;
    for (const unit of player.units(...Structures.types)) {
      if (
        !unit.isActive() ||
        unit.isUnderConstruction() ||
        !Number.isSafeInteger(unit.id()) ||
        unit.id() < 0 ||
        !structureTypes.has(unit.type())
      )
        continue;
      choices.push({
        memberId: player.id(),
        unitId: unit.id(),
        label: `${player.name()} · ${unit.type()} #${unit.id()} (level ${unit.level()})`,
      });
    }
  }
  return choices.sort(
    (a, b) => a.memberId.localeCompare(b.memberId) || a.unitId - b.unitId,
  );
}
