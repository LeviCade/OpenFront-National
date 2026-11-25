import type {
  ImperialReliefView,
  NationalImperialAdministrationView,
} from "@openfront/engine-api/game/NationalImperialView";
import { IntentSchema, type Intent } from "@openfront/engine-api/Schemas";

export type ReliefCommand =
  | {
      kind: "request-relief";
      empireId: string;
      reliefId: string;
      amount: string;
    }
  | {
      kind: "decide-relief";
      empireId: string;
      reliefId: string;
      expectedVersion: number;
      decision: "approve" | "reject";
    };

export function validReliefAmount(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,11}$/.test(value);
}

/** Only the existing engine schema determines the outbound wire shape. */
export function reliefIntent(
  command: ReliefCommand,
  requestId: string,
): Intent | null {
  const result = IntentSchema.safeParse({
    type: "national_imperial_administration",
    command,
    requestId,
  });
  return result.success &&
    result.data.type === "national_imperial_administration"
    ? result.data
    : null;
}

/** Presentation guard; Game reevaluates actual authority and funds at execution. */
export function reliefDecisionAllowed(
  view: NationalImperialAdministrationView,
  actorId: string,
  row: ImperialReliefView,
  decision: "approve" | "reject",
): boolean {
  return (
    view.canAmend &&
    view.empireId === row.empireId &&
    row.memberId !== actorId &&
    row.status === "pending" &&
    row.version === 0 &&
    validReliefAmount(row.amount) &&
    (decision === "reject" || BigInt(view.treasury) >= BigInt(row.amount))
  );
}
