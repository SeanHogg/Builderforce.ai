/**
 * The Playwright storageState for a signed-in Builderforce session: the tokens in
 * localStorage (the SPA reads these) and cookies (the Next.js middleware reads
 * these for SSR route protection). One builder for global-setup, the session
 * fixture and the exploration runner.
 */

import type { BfSession } from './bf';

export interface BfStorageState {
  cookies: Array<{
    name: string; value: string; domain: string; path: string; expires: number;
    httpOnly: boolean; secure: boolean; sameSite: 'Lax';
  }>;
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
}

export const WEB_TOKEN_KEY = 'bf_web_token';
export const TENANT_TOKEN_KEY = 'bf_tenant_token';

export function storageStateFor(session: BfSession, origin: string): BfStorageState {
  const { hostname } = new URL(origin);
  // SameSite=Lax, path=/ — mirrors what the SPA sets so the middleware accepts
  // server-rendered navigations.
  const cookie = (name: string, value: string) => ({
    name,
    value,
    domain: hostname,
    path: '/',
    expires: Math.floor(Date.now() / 1000) + 60 * 60 * 6,
    httpOnly: false,
    secure: hostname !== 'localhost',
    sameSite: 'Lax' as const,
  });
  return {
    cookies: [cookie(WEB_TOKEN_KEY, session.webToken), cookie(TENANT_TOKEN_KEY, session.tenantToken)],
    origins: [{
      origin,
      localStorage: [
        { name: WEB_TOKEN_KEY, value: session.webToken },
        { name: TENANT_TOKEN_KEY, value: session.tenantToken },
        { name: 'bf_user', value: JSON.stringify(session.user) },
        { name: 'bf_tenant', value: JSON.stringify(session.tenant) },
      ],
    }],
  };
}
