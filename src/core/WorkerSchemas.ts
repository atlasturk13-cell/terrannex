import { z } from "zod";
import {
  RemoteGameConfigPartialSchema,
  RemoteGameConfigSchema,
} from "./Schemas";

export const CreateGameInputSchema = RemoteGameConfigSchema.or(
  z
    .object({})
    .strict()
    .transform((val) => undefined),
);

// Retained for callers that accept a partial worker game configuration. This
// must match create_game's local-only profile boundary.
export const GameInputSchema = RemoteGameConfigPartialSchema;
