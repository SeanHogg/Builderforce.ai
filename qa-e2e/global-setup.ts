/**
 * Playwright global setup — establish an authenticated browser session ONCE.
 *
 * Logs into the auth API as the QA user, then writes a storageState file with
 * the tokens in both localStorage (the SPA reads these) and cookies (the
 * Next.js middleware reads these for SSR route protection). Every spec then
 * runs already-authenticated; no spec touches the login form.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { login, baseUrl } from './src/bf';

const STATE_PATH = process.env.BF_STORAGE_STATE ?? '.auth/state.json';

export default async function globalSetup(): Promise<void> {
  const session = await login();
  const origin = baseUrl();
  const { hostname } = new URL(origin);

  const localStorage = [
    { name: 'bf_web_token', value: session.webToken },
    { name: 'bf_tenant_token', value: session.tenantToken },
    { name: 'bf_user', value: JSON.stringify(session.user) },
    { name: 'bf_tenant', value: JSON.stringify(session.tenant) },
    { name: 'bf_default_tenant_id', value: String(session.tenant.id) },
  ];

  // SameSite=Lax, path=/ — mirrors what the SPA sets so the middleware accepts
  // server-rendered navigations.
  const cookies = [
    cookie('bf_web_token', session.webToken, hostname),
    cookie('bf_tenant_token', session.tenantToken, hostname),
  ];

  const state = { cookies, origins: [{ origin, localStorage }] };
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  // eslint-disable-next-line no-console
  console.log(`[qa-e2e] authenticated as ${session.user.email} → ${session.tenant.name} (#${session.tenant.id})`);
}

function cookie(name: string, value: string, domain: string) {
  return {
    name,
    value,
    domain,
    path: '/',
    expires: Math.floor(Date.now() / 1000) + 60 * 60 * 6,
    httpOnly: false,
    secure: domain !== 'localhost',
    sameSite: 'Lax' as const,
  };
}
