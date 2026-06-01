'use client';

/**
 * Agentic QA dashboard (Observability → Agentic QA tab).
 *
 * Per-project QA automation suite. Pick a project to configure its site-under-
 * test Target(s) and Credential library (test personas, passwords write-only),
 * then derive Flows (captured usage or AI crawl), generate per-persona Tests,
 * and review the Runs the CI harness posts back. With no project selected the
 * view is the workspace-level self-test (Builderforce app).
 */

import { useCallback, useEffect, useState } from 'react';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/types';
import {
  aggregateFlows,
  createCredential,
  createTarget,
  deleteCredential,
  deleteTarget,
  fetchCredentials,
  fetchFlows,
  fetchRuns,
  fetchTargets,
  fetchTests,
  generateTest,
  seedCrawl,
  type QaCredential,
  type QaFlow,
  type QaRun,
  type QaTarget,
  type QaTest,
} from '@/lib/qa/api';

// Authenticated nav routes worth smoke-testing the Builderforce app itself
// (self-test crawl seed when no project is selected).
const SELF_TEST_ROUTES = [
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

const inputStyle: React.CSSProperties = {
  padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-deep, #0d1117)', color: 'var(--text-primary)', minWidth: 120,
};

export function QaContent() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [flows, setFlows] = useState<QaFlow[]>([]);
  const [tests, setTests] = useState<QaTest[]>([]);
  const [runs, setRuns] = useState<QaRun[]>([]);
  const [targets, setTargets] = useState<QaTarget[]>([]);
  const [credentials, setCredentials] = useState<QaCredential[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects().then(setProjects).catch(() => { /* projects optional for self-test */ });
  }, []);

  const reload = useCallback(async () => {
    try {
      const [f, t, r] = await Promise.all([fetchFlows(projectId), fetchTests(projectId), fetchRuns(projectId)]);
      setFlows(f.flows ?? []);
      setTests(t.tests ?? []);
      setRuns(r.runs ?? []);
      if (projectId != null) {
        const [tg, cr] = await Promise.all([fetchTargets(projectId), fetchCredentials(projectId)]);
        setTargets(tg.targets ?? []);
        setCredentials(cr.credentials ?? []);
      } else {
        setTargets([]);
        setCredentials([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load QA data');
    }
  }, [projectId]);

  useEffect(() => { void reload(); }, [reload]);

  const run = useCallback(async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError(null);
    try { await fn(); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(null); }
  }, [reload]);

  const crawlRoutes = projectId != null
    ? (targets[0] ? ['/'] : []) // external site: crawl from root; refine once routes are known
    : SELF_TEST_ROUTES;

  return (
    <div>
      {/* Project selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Project</label>
        <select
          value={projectId ?? ''}
          onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
          style={{ ...inputStyle, minWidth: 240 }}
        >
          <option value="">Builderforce app (self-test)</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', marginBottom: 16, borderRadius: 6, background: 'rgba(248,81,73,0.1)', color: '#f85149', fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* Targets + Credentials only apply to a selected project */}
      {projectId != null && (
        <>
          <TargetsSection projectId={projectId} targets={targets} busy={busy} onRun={run} />
          <CredentialsSection projectId={projectId} credentials={credentials} busy={busy} onRun={run} />
        </>
      )}

      <Section
        title={`Flows (${flows.length})`}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            {projectId == null && (
              <button type="button" style={btnStyle(busy != null)} disabled={busy != null}
                onClick={() => run('agg', () => aggregateFlows(projectId))}>
                {busy === 'agg' ? 'Aggregating…' : 'Aggregate from usage'}
              </button>
            )}
            <button type="button" style={btnStyle(busy != null || crawlRoutes.length === 0)} disabled={busy != null || crawlRoutes.length === 0}
              onClick={() => run('crawl', () => seedCrawl(crawlRoutes, projectId, projectId != null ? 'Site smoke crawl' : 'Authenticated route smoke crawl'))}>
              {busy === 'crawl' ? 'Seeding…' : 'Seed AI crawl'}
            </button>
          </div>
        }
      >
        {flows.length === 0 ? (
          <Empty>No flows yet. {projectId != null ? 'Add a target then seed a crawl.' : 'Capture usage in the app or seed an AI crawl.'}</Empty>
        ) : (
          <Table head={['Flow', 'Source', 'Persona', 'Seen', '']}>
            {flows.map((f) => (
              <tr key={f.id}>
                <Td><strong style={{ color: 'var(--text-primary)' }}>{f.name}</strong></Td>
                <Td>{f.source}</Td>
                <Td>{f.personaRole ?? '—'}</Td>
                <Td>{f.frequency || '—'}</Td>
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
          <Table head={['Test', 'Persona', 'Model', 'Ver', 'Status']}>
            {tests.map((t) => (
              <tr key={t.id}>
                <Td><strong style={{ color: 'var(--text-primary)' }}>{t.name}</strong><br /><code style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t.slug}</code></Td>
                <Td>{(t.credentialId ? credentials.find((c) => c.id === t.credentialId)?.label : null) ?? t.personaRole ?? '—'}</Td>
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
          <Table head={['Test', 'Persona', 'Status', 'Steps', 'Duration', 'When']}>
            {runs.map((r) => (
              <tr key={r.id}>
                <Td>{r.testName ?? r.testSlug ?? '—'}</Td>
                <Td>{r.credentialLabel ?? r.credentialRole ?? '—'}</Td>
                <Td><span style={{ color: STATUS_COLOR[r.status] ?? 'var(--text-secondary)', fontWeight: 700 }}>{r.status}</span></Td>
                <Td>{r.passedSteps != null && r.totalSteps != null ? `${r.passedSteps}/${r.totalSteps}` : '—'}</Td>
                <Td>{r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : '—'}</Td>
                <Td>{new Date(r.createdAt).toLocaleString()}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}

// ── Targets ──────────────────────────────────────────────────────────────────

function TargetsSection({ projectId, targets, busy, onRun }: {
  projectId: number; targets: QaTarget[]; busy: string | null;
  onRun: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [name, setName] = useState('Production');
  const [baseUrl, setBaseUrl] = useState('');

  return (
    <Section title={`Targets (${targets.length})`}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input style={inputStyle} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input style={{ ...inputStyle, minWidth: 280 }} placeholder="https://app.example.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        <button type="button" style={btnStyle(busy != null || !baseUrl)} disabled={busy != null || !baseUrl}
          onClick={() => onRun('target-add', () => createTarget(projectId, { name, baseUrl, isDefault: targets.length === 0 }))}>
          Add target
        </button>
      </div>
      {targets.length === 0 ? (
        <Empty>No site-under-test yet. Add the project&apos;s root URL.</Empty>
      ) : (
        <Table head={['Name', 'Base URL', 'Default', '']}>
          {targets.map((t) => (
            <tr key={t.id}>
              <Td>{t.name}</Td>
              <Td><code style={{ fontSize: 11 }}>{t.baseUrl}</code></Td>
              <Td>{t.isDefault ? '★' : ''}</Td>
              <Td><button type="button" style={btnStyle(busy != null)} disabled={busy != null} onClick={() => onRun(`target-del-${t.id}`, () => deleteTarget(t.id))}>Delete</button></Td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

// ── Credentials (personas) ───────────────────────────────────────────────────

function CredentialsSection({ projectId, credentials, busy, onRun }: {
  projectId: number; credentials: QaCredential[]; busy: string | null;
  onRun: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [role, setRole] = useState('member');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginUrl, setLoginUrl] = useState('/login');

  const add = () => onRun('cred-add', async () => {
    await createCredential(projectId, { label, role, username, password, loginUrl });
    setLabel(''); setUsername(''); setPassword('');
  });

  return (
    <Section title={`Credentials / personas (${credentials.length})`}>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
        Logins the AI-generated scenarios run as. Passwords are encrypted at rest and never shown again.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input style={inputStyle} placeholder="Label (Admin user)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <select style={inputStyle} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="admin">admin</option>
          <option value="manager">manager</option>
          <option value="member">member</option>
          <option value="viewer">viewer</option>
        </select>
        <input style={inputStyle} placeholder="Username / email" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        <input style={inputStyle} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        <input style={inputStyle} placeholder="/login" value={loginUrl} onChange={(e) => setLoginUrl(e.target.value)} />
        <button type="button" style={btnStyle(busy != null || !label || !username || !password)} disabled={busy != null || !label || !username || !password} onClick={add}>
          Add persona
        </button>
      </div>
      {credentials.length === 0 ? (
        <Empty>No personas yet. Add at least one login the tests can use.</Empty>
      ) : (
        <Table head={['Label', 'Role', 'Username', 'Login URL', '']}>
          {credentials.map((c) => (
            <tr key={c.id}>
              <Td><strong style={{ color: 'var(--text-primary)' }}>{c.label}</strong></Td>
              <Td>{c.role ?? '—'}</Td>
              <Td><code style={{ fontSize: 11 }}>{c.username}</code></Td>
              <Td><code style={{ fontSize: 11 }}>{c.loginUrl ?? '/login'}</code></Td>
              <Td><button type="button" style={btnStyle(busy != null)} disabled={busy != null} onClick={() => onRun(`cred-del-${c.id}`, () => deleteCredential(c.id))}>Delete</button></Td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

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
