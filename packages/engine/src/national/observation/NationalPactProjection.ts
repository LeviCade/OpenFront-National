import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import {
  readNationalPublicPacts,
  readNationalPactDisclosure,
  type NationalPublicPactView,
  type NationalPactDisclosureViewData,
  type NationalPactDisclosureWireData,
} from "@openfront/engine-api/game/NationalPactView";
import type { Game, Player } from "../../game/Game";

/** E1 owns the two canonical reads. Optional only during parallel integration:
 * absence is unknown, never an empty authoritative roster or permission. */
type PactGame = Game & {
  nationalPactDisclosure?(actor: Player): NationalPactDisclosureViewData | null;
};

export function projectNationalPublicPacts(
  game: Game,
): NationalPublicPactView[] | undefined {
  const view = game.nationalPublicPoliticalView?.() as {
    pacts?: readonly NationalPublicPactView[];
  } | null;
  if (view?.pacts === undefined) return undefined;
  const selected = view.pacts.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    memberIds: [...p.memberIds],
    administratorId: p.administratorId,
  }));
  const safe = readNationalPublicPacts(selected);
  if (!safe) throw new Error("NATIONAL invalid authoritative pact roster");
  return safe;
}
export function projectNationalPactDisclosure(
  game: Game,
  observerId: string | null,
  roster: readonly NationalPublicPactView[] | undefined,
  tick = game.ticks(),
  streamId?: string,
): NationalPactDisclosureWireData | undefined {
  if (
    !roster ||
    !observerId ||
    !game.config().nationalMode() ||
    !game.hasPlayer(observerId)
  )
    return undefined;
  const actor = game.player(observerId);
  if (
    actor.type() !== PlayerType.Human ||
    !actor.hasSpawned() ||
    !actor.isAlive()
  )
    return undefined;
  const authority = game.nationalPoliticalAuthority();
  if (!authority || !authority.alive(observerId)) return undefined;
  const bind = (
    view: NationalPactDisclosureViewData,
  ): NationalPactDisclosureWireData => ({
    ...view,
    tick,
    ...(streamId === undefined ? {} : { streamId }),
  });
  if (tick !== game.ticks())
    throw new Error("NATIONAL stale pact projection tick");
  if (authority.empireOf(observerId))
    return bind({ version: 1, recipientId: observerId, pacts: [] });
  const source = (game as PactGame).nationalPactDisclosure?.(actor);
  if (source == null) return undefined;
  // Strictly reject foreign recipients and unexpected private nested data.
  const safe = readNationalPactDisclosure(source, observerId, roster, false);
  if (!safe) throw new Error("NATIONAL invalid authoritative pact disclosure");
  return bind(safe);
}
