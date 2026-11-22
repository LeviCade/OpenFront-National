import { GameMode, GameType } from "@openfront/engine-api/game/GameTypes";
import { GameConfigSchema } from "@openfront/engine-api/Schemas";
import { z } from "zod";

// `pool` points joiners at other lobbies, so only the authenticated admin-bot
// route (which parses GameConfigSchema directly) may set one.
// An authenticated browser can request a safe Private NATIONAL lobby
// without manufacturing unrelated GameConfig defaults.
const PrivateNationalCreateSchema = z
  .object({ nationalMode: z.literal(true) })
  .strict()
  .transform(() => ({
    nationalMode: true as const,
    gameType: GameType.Private,
    gameMode: GameMode.FFA,
    nations: "disabled" as const,
    bots: 0,
  }));

export const CreateGameInputSchema = GameConfigSchema.omit({ pool: true })
  .or(PrivateNationalCreateSchema)
  .or(
    z
      .object({})
      .strict()
      .transform(() => undefined),
  );

export type CreateGameInput = z.infer<typeof CreateGameInputSchema>;

// create_game only makes private lobbies. An empty body parses to undefined,
// which createGame fills in with its defaults (a private game).
export function isPrivateGameInput(input: CreateGameInput): boolean {
  return input === undefined || input.gameType === GameType.Private;
}

export const GameInputSchema = GameConfigSchema.partial();
