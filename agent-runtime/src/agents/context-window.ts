/**
 * THE context-window resolution for a `Model` — its declared window, else the
 * conservative default. Its own module (nothing but `defaults.ts` underneath) so the
 * native agent loop can size a model hand-off with it without importing the
 * compaction module, which imports the loop back.
 */

import type { Model } from "../builderforce/model/types.js";
import { DEFAULT_CONTEXT_TOKENS } from "./defaults.js";

export function resolveContextWindowTokens(model?: Model): number {
  return Math.max(1, Math.floor(model?.contextWindow ?? DEFAULT_CONTEXT_TOKENS));
}
