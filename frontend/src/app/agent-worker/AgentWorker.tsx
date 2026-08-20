'use client';

/**
 * Browser Agent Worker tab.
 *
 * This is the user-facing surface that actually RUNS agents in the browser: it
 * claims `browser` dispatches assigned to the tenant's swimlanes, runs each
 * agent's loop client-side against that agent's OWN model (via the gateway), and
 * reports results — which the server uses to autonomously advance the kanban.
 *
 * The agent loop + transport are the tested units (lib/browserRuntime/*). This
 * component wires them to a Start control and renders progress. The optional
 * `transport` prop lets tests drive it with a fake.
 */
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  runLoop,
  type BrowserRuntimeTransport,
  type ClaimedDispatch,
  type CodeResult,
  type RunHandlers,
  type RunOutcome,
} from '@/lib/browserRuntime/runner';
import PageContainer from '@/components/PageContainer';
import { createBrowserAgentTransport } from '@/lib/browserRuntime/transport';
import { runCodingDispatch, toResultPayload } from '@/lib/browserRuntime/coding';
import { createCodingDeps } from '@/lib/browserRuntime/factory';
import { getApiBaseUrl, getAuthHeaders } from '@/lib/apiClient';

/**
 * Default coding handler: for a repo-targeted dispatch, clone + edit + push
 * in-browser via the git-proxy (and optionally build in a WebContainer). Wired
 * from the real factory; tests inject their own handler instead.
 */
function defaultCodeHandler(transport: BrowserRuntimeTransport) {
  return async (dispatch: ClaimedDispatch): Promise<CodeResult> => {
    if (!dispatch.repo) return { status: 'failed', error: 'No repository bound to this task.' };
    const deps = createCodingDeps({
      dispatch,
      repo: dispatch.repo,
      apiBase: getApiBaseUrl(),
      authHeaders: getAuthHeaders(),
      callModel: transport.callModel,
      openPr: (pr) => transport.openPullRequest(dispatch.dispatchId, pr),
    });
    const result = await runCodingDispatch(
      { role: dispatch.role, input: dispatch.input },
      dispatch.repo,
      deps,
    );
    return {
      status: result.buildOk === false ? 'failed' : 'completed',
      // Structured, not prose: the server projects `files` into the task's change
      // feed so the Changes tab can list them and the diff viewer can open them.
      output: toResultPayload(result),
      error: result.buildOk === false ? result.summary : undefined,
    };
  };
}

export function AgentWorker({
  transport,
  handlers,
}: {
  transport?: BrowserRuntimeTransport;
  handlers?: RunHandlers;
}) {
  const t = useTranslations('agentWorker');
  const [running, setRunning] = useState(false);
  const [outcomes, setOutcomes] = useState<RunOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const t = transport ?? createBrowserAgentTransport();
      const h: RunHandlers = handlers ?? { code: defaultCodeHandler(t) };
      setOutcomes(await runLoop(t, { handlers: h }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [transport, handlers]);

  const completed = outcomes.filter((o) => o === 'completed').length;
  const failed = outcomes.filter((o) => o === 'failed').length;
  const ran = outcomes.filter((o) => o !== 'idle').length;

  return (
    <PageContainer width="readable" style={{ margin: '2rem 0', padding: '0 1rem' }}>
      <h1>{t('title')}</h1>
      <p>{t('intro')}</p>

      <button onClick={run} disabled={running} aria-label={t('runAria')}>
        {running ? t('running') : t('run')}
      </button>

      {error && (
        <p role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      <div data-testid="worker-summary" style={{ marginTop: '1rem' }}>
        {t('tally', { ran, completed, failed })}
      </div>

      <ul aria-label={t('outcomesAria')}>
        {outcomes.map((o, i) => (
          <li key={i}>{t(`outcome.${o}`)}</li>
        ))}
      </ul>
    </PageContainer>
  );
}
