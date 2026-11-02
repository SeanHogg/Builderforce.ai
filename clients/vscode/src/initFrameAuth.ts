import { clientPinOf } from "@builderforce/local-inference";

/**
 * The account fields of an `init` frame, decided from local state (no network):
 *
 *   - `token`: OMITTED when signed in without one yet (a degraded frame must not wipe the
 *     webview's live token — `bridgeState` keeps it); an explicit `null` means signed out.
 *   - `tenantId`: the tenant the frame is for, so a token-less frame for a DIFFERENT
 *     workspace makes the webview drop the old tenant's token instead of keeping it.
 *     Absent until the first mint (nothing to compare against yet).
 *   - `localPick`: the route is still resolving and the saved pick is an on-device model,
 *     so the panel may render without an account. It only skips the gate: the mint still runs.
 */
export function initFrameAuth(input: {
  signedIn: boolean;
  token: string | null;
  tenantId: number | undefined;
  routeDegraded: boolean;
  model: string | undefined;
}): { token?: string | null; tenantId?: number; localPick?: true } {
  return {
    ...(input.signedIn && input.token === null ? {} : { token: input.token }),
    ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
    ...(input.routeDegraded && clientPinOf(input.model) ? { localPick: true as const } : {}),
  };
}
