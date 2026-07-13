/**
 * runExploration — the Agentic Tester's core run: claim a heatmap-derived
 * exploration, drive a real browser through its plan, and feed captured runtime
 * errors back to the API. Used by the local CLI (explore.ts).
 *
 * NOTE: the PRODUCTION runner is the self-contained api/qa-container/server.mjs
 * (a no-build-step Node ESM port the Cloudflare Container can run directly). This
 * TS path is the local-dev mirror — keep the capture rules in sync.
 *
 * Auth is env-driven (BF_AGENT_TOKEN in production; operator login locally) —
 * see bf.ts. The caller sets BF_API_URL / BF_AGENT_TOKEN / BF_EXPLORATION_ID
 * before invoking.
 */

import { chromium } from '@playwright/test';
import {
  baseUrl,
  claimExploration,
  fetchCredentialSecret,
  login,
  patchExploration,
  postFindings,
  projectId,
  type BfSession,
} from './bf';
import { loginPersona } from './persona-login';
import { explore, outcomeStatus, summarize } from './explorer-engine';

/** Self-test storageState: the QA user's tokens in localStorage (SPA) + cookies
 *  (SSR middleware), mirroring global-setup so the explorer runs authenticated. */
function selfTestState(session: BfSession, origin: string) {
  const { hostname } = new URL(origin);
  const localStorage = [
    { name: 'bf_web_token', value: session.webToken },
    { name: 'bf_tenant_token', value: session.tenantToken },
    { name: 'bf_user', value: JSON.stringify(session.user) },
    { name: 'bf_tenant', value: JSON.stringify(session.tenant) },
    { name: 'bf_default_tenant_id', value: String(session.tenant.id) },
  ];
  const cookie = (name: string, value: string) => ({
    name, value, domain: hostname, path: '/',
    expires: Math.floor(Date.now() / 1000) + 60 * 60 * 6,
    httpOnly: false, secure: hostname !== 'localhost', sameSite: 'Lax' as const,
  });
  return {
    cookies: [cookie('bf_web_token', session.webToken), cookie('bf_tenant_token', session.tenantToken)],
    origins: [{ origin, localStorage }],
  };
}

export async function runExploration(): Promise<void> {
  const session = await login();

  const bundle = await claimExploration(session, {
    explorationId: process.env.BF_EXPLORATION_ID ?? null,
    projectId: projectId(),
  });
  if (!bundle.exploration) {
    console.log('[agentic-tester] no queued exploration to run.');
    return;
  }
  const explorationId = bundle.exploration.id;
  const plan = bundle.plan ?? [];
  const runBaseUrl = bundle.target?.baseUrl ?? baseUrl();
  console.log(`[agentic-tester] claimed exploration ${explorationId} — ${plan.length} step(s) against ${runBaseUrl}`);

  if (plan.length === 0) {
    await patchExploration(session, explorationId, { status: 'error', errorMessage: 'Exploration had an empty plan.', targetUrl: runBaseUrl });
    return;
  }

  // --no-sandbox so this works when run as root in a container (parity with
  // api/qa-container/server.mjs); --disable-dev-shm-usage avoids small-/dev/shm crashes.
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    // Establish the session: persona login (project mode) or injected QA tokens.
    let storageState: Awaited<ReturnType<typeof loginPersona>> | ReturnType<typeof selfTestState>;
    if (bundle.credential) {
      const secret = await fetchCredentialSecret(session, bundle.credential.id);
      storageState = await loginPersona(runBaseUrl, secret);
    } else {
      storageState = selfTestState(session, runBaseUrl);
    }

    const context = await browser.newContext({ baseURL: runBaseUrl, storageState });
    const page = await context.newPage();

    const { findings, zonesExplored } = await explore(page, plan);
    console.log(`[agentic-tester] explored ${zonesExplored} zone(s), captured ${findings.length} finding(s).`);

    await postFindings(session, explorationId, findings);
    await patchExploration(session, explorationId, {
      status: outcomeStatus(findings),
      zonesExplored,
      browser: 'chromium',
      targetUrl: runBaseUrl,
      commitSha: process.env.GITHUB_SHA,
      runKey: process.env.GITHUB_RUN_ID,
      summary: summarize(findings),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[agentic-tester] exploration failed:', message);
    await patchExploration(session, explorationId, { status: 'error', errorMessage: message, targetUrl: runBaseUrl }).catch(() => {});
    throw err;
  } finally {
    await browser.close();
  }
}
