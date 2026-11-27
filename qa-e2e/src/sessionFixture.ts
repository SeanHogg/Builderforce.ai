/**
 * `test` for specs that run signed in to Builderforce (self-test mode).
 *
 * Web tokens are short-lived and ROTATE when renewed: the browser swaps the stored
 * token for a successor and the old one is spent. A single storageState snapshot
 * shared by every context therefore breaks as soon as one context renews it — the
 * next context starts from the spent token. So each WORKER holds its own session
 * (one sign-in per worker), every test starts from a freshly renewed token, and a
 * token the page itself rotated during the test is adopted for the next one.
 *
 * Project mode keeps the per-persona storageState the generated specs declare.
 */

import { test as base } from '@playwright/test';
import { baseUrl, login, projectId, renewSession, type BfSession } from './bf';
import { storageStateFor, TENANT_TOKEN_KEY, WEB_TOKEN_KEY } from './storageState';

interface WorkerSession {
  current: BfSession | null;
}

/** Renew the worker's session; one a test ended (signed out, reached its age) is replaced by a new sign-in. */
async function renewOrSignIn(session: BfSession): Promise<BfSession> {
  try {
    return await renewSession(session);
  } catch (error) {
    console.warn(`[qa-e2e] session renewal refused, signing in again: ${error instanceof Error ? error.message : String(error)}`);
    return login();
  }
}

export const test = base.extend<{ adoptRotatedSession: void }, { bfSession: WorkerSession }>({
  bfSession: [async ({}, use) => {
    await use({ current: null });
  }, { scope: 'worker' }],

  storageState: async ({ storageState, bfSession, baseURL }, use) => {
    if (projectId() != null) {
      await use(storageState);
      return;
    }
    bfSession.current = bfSession.current ? await renewOrSignIn(bfSession.current) : await login();
    await use(storageStateFor(bfSession.current, baseURL ?? baseUrl()));
  },

  adoptRotatedSession: [async ({ context, bfSession }, use) => {
    await use();
    if (projectId() != null || !bfSession.current) return;
    const stored = (await context.storageState()).origins.flatMap((o) => o.localStorage);
    const webToken = stored.find((e) => e.name === WEB_TOKEN_KEY)?.value;
    const tenantToken = stored.find((e) => e.name === TENANT_TOKEN_KEY)?.value;
    if (webToken && webToken !== bfSession.current.webToken) {
      bfSession.current = { ...bfSession.current, webToken, tenantToken: tenantToken ?? bfSession.current.tenantToken };
    }
  }, { auto: true }],
});

export { expect } from '@playwright/test';
