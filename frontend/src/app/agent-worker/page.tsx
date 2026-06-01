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
import { runLoop, type BrowserRuntimeTransport, type RunOutcome } from '@/lib/browserRuntime/runner';
import { createBrowserAgentTransport } from '@/lib/browserRuntime/transport';

export function AgentWorker({ transport }: { transport?: BrowserRuntimeTransport }) {
  const [running, setRunning] = useState(false);
  const [outcomes, setOutcomes] = useState<RunOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const t = transport ?? createBrowserAgentTransport();
      setOutcomes(await runLoop(t));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [transport]);

  const completed = outcomes.filter((o) => o === 'completed').length;
  const failed = outcomes.filter((o) => o === 'failed').length;
  const ran = outcomes.filter((o) => o !== 'idle').length;

  return (
    <main style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Browser Agent Worker</h1>
      <p>
        Runs the agents assigned to your boards&apos; swimlanes directly in this tab, each on its own
        model. As agents finish, the kanban advances autonomously.
      </p>

      <button onClick={run} disabled={running} aria-label="Run pending agents">
        {running ? 'Running…' : 'Run pending agents'}
      </button>

      {error && (
        <p role="alert" style={{ color: 'crimson' }}>
          {error}
        </p>
      )}

      <div data-testid="worker-summary" style={{ marginTop: '1rem' }}>
        Ran {ran} · Completed {completed} · Failed {failed}
      </div>

      <ul aria-label="run outcomes">
        {outcomes.map((o, i) => (
          <li key={i}>{o}</li>
        ))}
      </ul>
    </main>
  );
}

export default function AgentWorkerPage() {
  return <AgentWorker />;
}
