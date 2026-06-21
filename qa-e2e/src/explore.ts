/**
 * Agentic Tester entrypoint — claim a heatmap-derived exploration, drive a real
 * browser through it, and feed captured runtime errors back to the API.
 *
 * Designed to run in a container (see Dockerfile): one process, no `playwright
 * test` runner, no GitHub Actions assumptions. Flow:
 *   1. Authenticate as the QA user (bf.login).
 *   2. Claim a queued exploration (BF_EXPLORATION_ID, else oldest queued for
 *      BF_PROJECT_ID, else oldest queued in the workspace).
 *   3. Establish a session: project mode logs the persona into the site under
 *      test; self-test injects the QA user's Builderforce tokens.
 *   4. Run the explorer engine over the plan → findings.
 *   5. POST findings, PATCH the run outcome.
 *
 * Env:
 *   BF_EXPLORATION_ID  optional — claim this specific exploration
 *   BF_PROJECT_ID      optional — claim the next queued exploration for a project
 *   (plus the BF_* auth vars consumed by bf.login)
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

async function main(): Promise<void> {
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

  const browser = await chromium.launch();
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
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[agentic-tester] fatal:', err);
  process.exit(1);
});
