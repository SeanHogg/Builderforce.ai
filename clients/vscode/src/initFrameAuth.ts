import { clientPinOf } from "@builderforce/local-inference";

/**
 * The account fields of an `init` frame, decided from local state (no network):
 *
 *   - `token`: the token BOUND to the workspace in force (`boundToken`). OMITTED when
 *     signed in without one (not minted yet, or a parked re-scope handed back another
 *     tenant's base token): a degraded frame must not wipe the webview's live token
 *     (`bridgeState` keeps it); an explicit `null` means signed out.
 *   - `tenantId`: the tenant the frame is for - the bound token's, else the workspace's -
 *     so a token-less frame for a DIFFERENT workspace makes the webview drop the old
 *     tenant's token instead of keeping it. Absent until the first mint.
 *   - `localPick`: the route is still resolving and the saved pick is an on-device model,
 *     so the panel may render without an account. It only skips the gate: the mint still runs.
 */
export function initFrameAuth(input: {
  signedIn: boolean;
  bound: { token: string; tenantId: number } | null;
  workspaceTenantId: number | undefined;
  routeDegraded: boolean;
  model: string | undefined;
}): { token?: string | null; tenantId?: number; localPick?: true } {
  const tenantId = input.bound?.tenantId ?? input.workspaceTenantId;
  return {
    ...(input.signedIn && !input.bound ? {} : { token: input.bound?.token ?? null }),
    ...(tenantId !== undefined ? { tenantId } : {}),
    ...(input.routeDegraded && clientPinOf(input.model) ? { localPick: true as const } : {}),
  };
}
