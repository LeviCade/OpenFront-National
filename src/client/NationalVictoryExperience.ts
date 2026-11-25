import {
  readNationalConfirmedVictory,
  type NationalConfirmedVictory,
} from "@openfront/engine-api/game/NationalVictoryView";
import type {
  NationalPublicPolitics,
  NationalUngovernableWarning,
} from "./NationalDiplomacyState";

export const nationalAwardTitles = {
  SovereignVictor: "Sovereign Victor",
  ImperialVictor: "Imperial Victor",
  EmpireVictor: "Empire Victor",
} as const;

export function nationalVictoryAt(
  politics: NationalPublicPolitics | null,
  politicsTick: number | null,
  tick: number,
): NationalConfirmedVictory | null {
  return politicsTick === tick
    ? readNationalConfirmedVictory(politics?.victory, tick)
    : null;
}

export function nationalVictoryPresentation(
  victory: NationalConfirmedVictory,
  actor: string | null,
  publicName: (id: string) => string,
) {
  const own = victory.prizes.find((p) => p.nationId === actor);
  const sovereign = victory.prizes[0];
  return {
    award: own?.kind ?? null,
    title: own
      ? nationalAwardTitles[own.kind]
      : `NATIONAL victory: ${nationalAwardTitles[sovereign.kind]} — ${publicName(sovereign.nationId)}`,
    won: own !== undefined,
  };
}

export interface NationalCrisis extends NationalUngovernableWarning {
  readonly successorIds: readonly string[];
}

/** Simulation ticks are 100 ms in NationalRuntime. Never use Date or timers. */
export function nationalCrisisAt(
  politics: NationalPublicPolitics | null,
  actor: string | null,
  tick: number,
): NationalCrisis | null {
  if (!actor || !Number.isSafeInteger(tick * 100) || tick < 0) return null;
  const empire = politics?.empires.find((e) => e.leaderId === actor);
  if (!empire || !politics) return null;
  const warning = politics.warnings.find((w) => w.empireId === empire.id);
  if (
    !warning ||
    warning.remainingMs !== Math.max(0, warning.deadlineMs - tick * 100) ||
    warning.remainingMs > 10_000 ||
    warning.blockedByAssetDisposition !== (warning.remainingMs === 0)
  )
    return null;
  return {
    ...warning,
    successorIds: empire.memberIds.filter((id) => id !== actor),
  };
}

/** Only consecutive authorized, current projections can establish a transition. */
export class NationalCrisisTracker {
  private identity: string | null = null;
  private tick = -1;
  private empireId: string | null = null;
  private wasEmperor = false;
  private wasWarned = false;
  private resolution = "";

  clear(): void {
    this.identity = null;
    this.tick = -1;
    this.empireId = null;
    this.wasEmperor = false;
    this.wasWarned = false;
    this.resolution = "";
  }

  observe(
    gameId: string,
    actor: string | null,
    tick: number,
    politics: NationalPublicPolitics | null,
  ): string {
    if (!actor || !politics) {
      this.clear();
      return "";
    }
    const identity = JSON.stringify([gameId, actor]);
    if (this.identity !== identity || tick < this.tick) this.clear();
    const empire = politics.empires.find((e) => e.memberIds.includes(actor));
    const warning = nationalCrisisAt(politics, actor, tick);
    if (this.identity === identity && tick > this.tick) {
      if (
        this.empireId !== null &&
        !empire &&
        !politics.empires.some((e) => e.id === this.empireId)
      ) {
        this.resolution = "Empire dissolved — your independent sovereignty is restored.";
      } else if (
        empire &&
        empire.id === this.empireId &&
        this.wasEmperor &&
        empire.leaderId !== actor
      ) {
        this.resolution = "Crown transferred — the new emperor now holds authority.";
      } else if (this.wasWarned && !warning && empire?.leaderId === actor) {
        this.resolution = "The game cleared the Ungovernable warning.";
      }
    }
    if (warning) this.resolution = "";
    this.identity = identity;
    this.tick = tick;
    this.empireId = empire?.id ?? null;
    this.wasEmperor = empire?.leaderId === actor;
    this.wasWarned = warning !== null;
    return this.resolution;
  }
}
