'use client';

/**
 * Agentic QA dashboard (Observability → Agentic QA tab).
 *
 * Shows the three stages of the pipeline: derived Flows (from captured usage or
 * an AI crawl), generated Playwright Tests, and the Runs the CI harness posts
 * back. Lets an operator aggregate usage into flows, seed a crawl, and generate
 * a test per flow.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  aggregateFlows,
  fetchFlows,
  fetchRuns,
  fetchTests,
  generateTest,
  seedCrawl,
  type QaFlow,
  type QaRun,
  type QaTest,
} from '@/lib/qa/api';

// The authenticated nav routes worth smoke-testing — used to seed an AI crawl
// when there's no captured usage yet (the crawl half of the hybrid strategy).
const SMOKE_ROUTES = [
  '/dashboard', '/projects', '/ide', '/tasks', '/chats', '/training',
  '/skills', '/personas', '/approvals', '/settings', '/observability',
];

const STATUS_COLOR: Record<string, string> = {
  passed: '#3fb950', failed: '#f85149', error: '#f85149', skipped: '#8b949e',
  running: '#d29922', queued: '#8b949e',
};

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function btnStyle(disabled = false): React.CSSProperties {
  return {
    padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6,
    border: '1px solid var(--border-subtle)', background: 'var(--surface-raised, #1c2128)',
    color: 'var(--text-secondary)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
  };
}

export function QaContent() {
  const [flows, setFlows] = useState<QaFlow[]>([]);
  const [tests, setTests] = useState<QaTest[]>([]);
  const [runs, setRuns] = useState<QaRun[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [f, t, r] = await Promise.all([fetchFlows(), fetchTests(), fetchRuns()]);
      setFlows(f.flows ?? []);
      setTests(t.tests ?? []);
      setRuns(r.runs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load QA data');
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const run = useCallback(async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError(null);
    try { await fn(); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(null); }
  }, [reload]);

  return (
    <div>
      {error && (
        <div style={{ padding: '8px 12px', marginBottom: 16, borderRadius: 6, background: 'rgba(248,81,73,0.1)', color: '#f85149', fontSize: 12 }}>
          {error}
        </div>
      )}

      <Section
        title={`Flows (${flows.length})`}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={btnStyle(busy != null)} disabled={busy != null}
              onClick={() => run('agg', aggregateFlows)}>
              {busy === 'agg' ? 'Aggregating…' : 'Aggregate from usage'}
            </button>
            <button type="button" style={btnStyle(busy != null)} disabled={busy != null}
              onClick={() => run('crawl', () => seedCrawl(SMOKE_ROUTES, 'Authenticated route smoke crawl'))}>
              {busy === 'crawl' ? 'Seeding…' : 'Seed AI crawl'}
            </button>
          </div>
        }
      >
        {flows.length === 0 ? (
          <Empty>No flows yet. Capture usage in the app or seed an AI crawl to get started.</Empty>
        ) : (
          <Table head={['Flow', 'Source', 'Seen', 'Start route', '']}>
            {flows.map((f) => (
              <tr key={f.id}>
                <Td><strong style={{ color: 'var(--text-primary)' }}>{f.name}</strong></Td>
                <Td>{f.source}</Td>
                <Td>{f.frequency || '—'}</Td>
                <Td><code style={{ fontSize: 11 }}>{f.startRoute ?? '—'}</code></Td>
                <Td>
                  <button type="button" style={btnStyle(busy != null)} disabled={busy != null}
                    onClick={() => run(`gen-${f.id}`, () => generateTest(f.id))}>
                    {busy === `gen-${f.id}` ? 'Generating…' : 'Generate test'}
                  </button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title={`Generated tests (${tests.length})`}>
        {tests.length === 0 ? (
          <Empty>No tests generated yet. Generate one from a flow above.</Empty>
        ) : (
          <Table head={['Test', 'Framework', 'Model', 'Ver', 'Status']}>
            {tests.map((t) => (
              <tr key={t.id}>
                <Td><strong style={{ color: 'var(--text-primary)' }}>{t.name}</strong><br /><code style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t.slug}</code></Td>
                <Td>{t.framework}</Td>
                <Td>{t.model ?? 'fallback'}</Td>
                <Td>v{t.version}</Td>
                <Td>{t.status}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title={`Recent runs (${runs.length})`}>
        {runs.length === 0 ? (
          <Empty>No runs yet. The CI harness posts results here after each suite.</Empty>
        ) : (
          <Table head={['Test', 'Status', 'Steps', 'Duration', 'Commit', 'When']}>
            {runs.map((r) => (
              <tr key={r.id}>
                <Td>{r.testName ?? r.testSlug ?? '—'}</Td>
                <Td><span style={{ color: STATUS_COLOR[r.status] ?? 'var(--text-secondary)', fontWeight: 700 }}>{r.status}</span></Td>
                <Td>{r.passedSteps != null && r.totalSteps != null ? `${r.passedSteps}/${r.totalSteps}` : '—'}</Td>
                <Td>{r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : '—'}</Td>
                <Td><code style={{ fontSize: 11 }}>{r.commitSha ? r.commitSha.slice(0, 7) : '—'}</code></Td>
                <Td>{new Date(r.createdAt).toLocaleString()}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>{children}</p>;
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-subtle)' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: '8px', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'top' }}>{children}</td>;
}
