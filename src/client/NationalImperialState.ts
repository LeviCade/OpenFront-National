import { Structures, UnitType } from "@openfront/engine-api/game/GameTypes";
import type { NationalImperialAdministrationView } from "@openfront/engine-api/game/NationalImperialView";
import { IntentSchema, type Intent } from "@openfront/engine-api/Schemas";

export type ImperialPolicyCommand =
  | {
      kind: "set-policy";
      empireId: string;
      policy: {
        workerIncomeBps: number;
        allowedConstruction: UnitType[] | null;
      };
    }
  | {
      kind: "set-army-mode";
      empireId: string;
      mode: "decentralized" | "hybrid" | "centralized";
      thresholdBps: number;
    };

export const imperialConstructionCategories: readonly UnitType[] = [
  ...new Set([...Structures.types, UnitType.Warship]),
];
/** E1 owns the exact appended intent schema. Standalone E4 must not create an
 * alternative wire command or show a functional control before it exists. */
export function parseImperialCommand(
  command: ImperialPolicyCommand,
  requestId: string,
): Intent | null {
  const parsed = IntentSchema.safeParse({
    type: "national_imperial_administration",
    command,
    requestId,
  });
  return parsed.success &&
    String(parsed.data.type) === "national_imperial_administration"
    ? parsed.data
    : null;
}
export function imperialPolicyKey(
  view: NationalImperialAdministrationView,
): string {
  // Treasury and reserve balances may legitimately change during form editing.
  return JSON.stringify([
    view.empireId,
    view.canAmend,
    view.workerIncomeBps,
    view.allowedConstruction,
    view.armyMode,
    view.hybridThresholdBps,
  ]);
}
export function imperialPolicyIntentAvailable(
  view: NationalImperialAdministrationView,
  kind: ImperialPolicyCommand["kind"],
): boolean {
  if (!view.canAmend) return false;
  const command: ImperialPolicyCommand =
    kind === "set-policy"
      ? {
          kind,
          empireId: view.empireId,
          policy: {
            workerIncomeBps: view.workerIncomeBps,
            allowedConstruction:
              view.allowedConstruction === null
                ? null
                : [...view.allowedConstruction],
          },
        }
      : {
          kind,
          empireId: view.empireId,
          mode: view.armyMode ?? "decentralized",
          thresholdBps: view.hybridThresholdBps ?? 0,
        };
  return (
    (kind !== "set-army-mode" || view.armyMode !== undefined) &&
    parseImperialCommand(command, "np_" + "0".repeat(32)) !== null
  );
}
