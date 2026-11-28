export const TENANT_SESSION_TTL_SECONDS = 3600;

const REFRESH_MARGIN_MS = 60_000;

export function tenantSessionExpiresAt(now: number, expiresIn?: number): number {
  return now + (expiresIn ?? TENANT_SESSION_TTL_SECONDS) * 1000;
}

export function isTenantSessionFresh(expiresAt: number, now: number): boolean {
  return now < expiresAt - REFRESH_MARGIN_MS;
}

/** Try once with a fresh token after a 401 when the request body can be replayed. */
export async function sendWithTenantSession(
  jwt: (force?: boolean) => Promise<string | null | undefined>,
  send: (token: string) => Promise<Response>,
  canReplay = true,
): Promise<Response | undefined> {
  const token = await jwt();
  if (!token) return undefined;
  const response = await send(token);
  if (response.status !== 401 || !canReplay) return response;

  const refreshedToken = await jwt(true);
  return refreshedToken ? send(refreshedToken) : undefined;
}
