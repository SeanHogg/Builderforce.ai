/**
 * Playwright global setup — establish an authenticated browser session ONCE.
 *
 * Logs into the auth API as the QA user, then writes a storageState file with
 * the tokens in both localStorage (the SPA reads these) and cookies (the
 * Next.js middleware reads these for SSR route protection).
 *
 * Specs that run signed in take their session from `src/sessionFixture.ts`
 * instead (one session per worker, renewed per test): web tokens are short-lived
 * and rotate on renewal, so one snapshot shared by every context stops working
 * once any context renews it. This file stays for tools that read the state file.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { login, baseUrl, projectId } from './src/bf';
import { storageStateFor } from './src/storageState';

const STATE_PATH = process.env.BF_STORAGE_STATE ?? '.auth/state.json';

export default async function globalSetup(): Promise<void> {
  // Project mode: pull-tests already logged each persona in and wrote per-
  // credential storageState files; specs carry their own `test.use({ ... })`.
  // Nothing to do here.
  if (projectId() != null) {
    console.log('[qa-e2e] project mode — per-persona sessions established by pull-tests.');
    return;
  }

  const session = await login();
  const state = storageStateFor(session, baseUrl());
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  // eslint-disable-next-line no-console
  console.log(`[qa-e2e] authenticated as ${session.user.email} → ${session.tenant.name} (#${session.tenant.id})`);
}
