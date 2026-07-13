/**
 * Native model-SDK shims — the pi-free replacement for the `@mariozechner/pi-ai` helpers
 * `getEnvApiKey` + `getModel` (PI cutover, model layer). The on-prem runtime is
 * GATEWAY-routed (locked decision 2): there is no bundled per-provider model catalog and
 * no per-provider env-key resolver here — model specs come from `cfg.models.providers` +
 * the gateway, and credentials resolve through `model-auth.ts` / auth-profiles.
 *
 * Behavior delta (logged in the Gap Register): pi's `getModel(id)` catalog lookup and its
 * `getEnvApiKey` (incl. Google Vertex gcloud ADC) are not reproduced — `getModel` returns
 * `undefined` (callers synthesize from config) and `getEnvApiKey` returns `undefined`
 * (callers fall through to the normal auth resolution).
 */

import type { Api, Model } from "../builderforce/model/types.js";

/** No bundled catalog — gateway-routed callers synthesize a Model from config. Variadic to
 *  match pi's `getModel(id)` and `getModel(api, id)` call shapes. */
export function getModel(..._args: string[]): Model<Api> | undefined {
  return undefined;
}

/** No per-provider env resolver here — auth flows through `model-auth.ts`/auth-profiles. */
export function getEnvApiKey(_provider: string): string | undefined {
  return undefined;
}
