'use client';

import { Select } from '@/components/Select';

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
  createSchedule,
  createTarget,
  createTaskFromFinding,
  deleteCredential,
  deleteSchedule,
  deleteTarget,
  fetchCredentials,
  fetchExploration,
  fetchExplorations,
  fetchFlows,
  fetchHeatmap,
  fetchRuns,
  fetchSchedules,
  fetchTargets,
  fetchTests,
  generateTest,
  seedCrawl,
  startExploration,
  updateSchedule,
  type QaCredential,
  type QaExploration,
  type QaFinding,
  type QaFlow,
  type QaHeatZone,
  type QaRun,
  type QaSchedule,
  type QaTarget,
  type QaTest,
} from '@/lib/qa/api';

// Authenticated nav routes worth smoke-testing the Builderforce app itself
// (self-test crawl seed when no project is selected).
const SELF_TEST_ROUTES = [
  '/dashboard', '/projects', '/ide', '/tasks', '/training',
  '/skills', '/personas', '/settings', '/workforce',
  '/workforce?tab=chats', '/workforce?tab=approvals',
];

const STATUS_COLOR: Record<string, string> = {
  passed: '#3fb950', failed: '#f85149', error: '#f85149', skipped: '#8b949e',
  running: '#d29922', queued: '#8b949e',
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#f85149', high: '#f85149', medium: '#d29922', low: '#8b949e',
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
  const [heatZones, setHeatZones] = useState<QaHeatZone[]>([]);
  const [explorations, setExplorations] = useState<QaExploration[]>([]);
  const [schedules, setSchedules] = useState<QaSchedule[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects().then(setProjects).catch(() => { /* projects optional for self-test */ });
  }, []);

  const reload = useCallback(async () => {
    try {
      const [f, t, r, hm, ex] = await Promise.all([
        fetchFlows(projectId), fetchTests(projectId), fetchRuns(projectId),
        fetchHeatmap({ limit: 40 }).catch(() => ({ zones: [] })),
        fetchExplorations(projectId).catch(() => ({ explorations: [] })),
      ]);
      setFlows(f.flows ?? []);
      setTests(t.tests ?? []);
      setRuns(r.runs ?? []);
      setHeatZones(hm.zones ?? []);
      setExplorations(ex.explorations ?? []);
      if (projectId != null) {
        const [tg, cr, sc] = await Promise.all([
          fetchTargets(projectId), fetchCredentials(projectId),
          fetchSchedules(projectId).catch(() => ({ schedules: [] })),
        ]);
        setTargets(tg.targets ?? []);
        setCredentials(cr.credentials ?? []);
        setSchedules(sc.schedules ?? []);
      } else {
        setTargets([]);
        setCredentials([]);
        setSchedules([]);
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
        <Select
          value={projectId ?? ''}
          onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
          style={{ ...inputStyle, minWidth: 240 }}
        >
          <option value="">Builderforce app (self-test)</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', marginBottom: 16, borderRadius: 6, background: 'rgba(248,81,73,0.1)', color: '#f85149', fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* Targets + Credentials + Schedule only apply to a selected project */}
      {projectId != null && (
        <>
          <TargetsSection projectId={projectId} targets={targets} busy={busy} onRun={run} />
          <CredentialsSection projectId={projectId} credentials={credentials} busy={busy} onRun={run} />
          <SchedulesSection projectId={projectId} schedules={schedules} credentials={credentials} busy={busy} onRun={run} />
        </>
      )}

      <AgenticTesterSection
        projectId={projectId}
        heatZones={heatZones}
        explorations={explorations}
        busy={busy}
        onRun={run}
      />

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

// ── Agentic Tester (heatmap-driven exploration) ───────────────────────────────

function AgenticTesterSection({ projectId, heatZones, explorations, busy, onRun }: {
  projectId: number | null;
  heatZones: QaHeatZone[];
  explorations: QaExploration[];
  busy: string | null;
  onRun: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [budget, setBudget] = useState(20);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Section
      title="Agentic Tester"
      action={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Zones</label>
          <input
            type="number" min={1} max={100} value={budget}
            onChange={(e) => setBudget(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
            style={{ ...inputStyle, minWidth: 64, width: 64 }}
          />
          <button
            type="button"
            style={btnStyle(busy != null || heatZones.length === 0)}
            disabled={busy != null || heatZones.length === 0}
            onClick={() => onRun('explore-start', () => startExploration({ projectId, heatBudget: budget }))}
          >
            {busy === 'explore-start' ? 'Queuing…' : 'Run agentic tester'}
          </button>
        </div>
      }
    >
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
        Decides what to exercise from interaction <strong>heat</strong> (the busiest routes &amp; controls),
        drives a real browser through them in a container, and feeds captured runtime errors back as findings —
        each can spawn a board task to fix it.
      </p>

      {/* Heatmap — the hottest zones the next run will prioritise. */}
      {heatZones.length === 0 ? (
        <Empty>No heatmap data yet. Capture usage in the app (interactions) before running the tester.</Empty>
      ) : (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Hottest zones ({heatZones.length})</div>
          <Table head={['Route', 'Element', 'Kind', 'Heat']}>
            {heatZones.slice(0, 8).map((z, i) => (
              <tr key={`${z.route}-${z.selector ?? i}`}>
                <Td><code style={{ fontSize: 11 }}>{z.route}</code></Td>
                <Td>{z.label ?? (z.selector ? <code style={{ fontSize: 10 }}>{z.selector.slice(0, 48)}</code> : '— (page)')}</Td>
                <Td>{z.kind}</Td>
                <Td><HeatBar heat={z.heat} max={heatZones[0]?.heat ?? 1} /></Td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {/* Explorations — the runs and their findings. */}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '18px 0 6px' }}>Explorations ({explorations.length})</div>
      {explorations.length === 0 ? (
        <Empty>No explorations yet. Queue one above; a container harness drains the queue and reports findings here.</Empty>
      ) : (
        <Table head={['When', 'Status', 'Zones', 'Findings', 'Summary', '']}>
          {explorations.map((ex) => (
            <tr key={ex.id}>
              <Td>{new Date(ex.createdAt).toLocaleString()}</Td>
              <Td><span style={{ color: STATUS_COLOR[ex.status] ?? 'var(--text-secondary)', fontWeight: 700 }}>{ex.status}</span></Td>
              <Td>{ex.zonesExplored != null ? `${ex.zonesExplored}/${ex.zonesPlanned}` : ex.zonesPlanned}</Td>
              <Td>{ex.findingsCount}</Td>
              <Td style={{ maxWidth: 280 }}>{ex.summary ?? ex.errorMessage ?? '—'}</Td>
              <Td>
                <button type="button" style={btnStyle(busy != null)} disabled={busy != null}
                  onClick={() => setOpenId(openId === ex.id ? null : ex.id)}>
                  {openId === ex.id ? 'Hide' : 'Findings'}
                </button>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {openId && <FindingsPanel explorationId={openId} busy={busy} onRun={onRun} />}
    </Section>
  );
}

function HeatBar({ heat, max }: { heat: number; max: number }) {
  const pct = max > 0 ? Math.round((heat / max) * 100) : 0;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ display: 'inline-block', width: 60, height: 6, borderRadius: 3, background: 'var(--border-subtle)' }}>
        <span style={{ display: 'block', width: `${pct}%`, height: 6, borderRadius: 3, background: '#d29922' }} />
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{heat}</span>
    </span>
  );
}

function FindingsPanel({ explorationId, busy, onRun }: {
  explorationId: string;
  busy: string | null;
  onRun: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [findings, setFindings] = useState<QaFinding[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchExploration(explorationId);
      setFindings(res.findings ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load findings');
    }
  }, [explorationId]);

  useEffect(() => { void load(); }, [load]);

  if (loadError) return <Empty>{loadError}</Empty>;
  if (findings == null) return <Empty>Loading findings…</Empty>;
  if (findings.length === 0) return <Empty>No runtime errors captured in this exploration. 🎉</Empty>;

  return (
    <div style={{ marginTop: 12, padding: 12, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-deep, #0d1117)' }}>
      <Table head={['Severity', 'Type', 'Route', 'Heat', 'Message', '']}>
        {findings.map((f) => (
          <tr key={f.id}>
            <Td><span style={{ color: SEVERITY_COLOR[f.severity] ?? 'var(--text-secondary)', fontWeight: 700 }}>{f.severity}</span></Td>
            <Td>{f.type}</Td>
            <Td><code style={{ fontSize: 10 }}>{f.route ?? '—'}</code></Td>
            <Td>{f.heat}</Td>
            <Td style={{ maxWidth: 360 }}><code style={{ fontSize: 11 }}>{f.message.slice(0, 200)}</code></Td>
            <Td>
              {f.taskId ? (
                <span style={{ fontSize: 11, color: '#3fb950' }}>Task #{f.taskId}</span>
              ) : f.projectId == null ? (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>self-test</span>
              ) : (
                <button type="button" style={btnStyle(busy != null)} disabled={busy != null}
                  onClick={() => onRun(`finding-task-${f.id}`, async () => { await createTaskFromFinding(f.id); await load(); })}>
                  {busy === `finding-task-${f.id}` ? 'Creating…' : 'Create task'}
                </button>
              )}
            </Td>
          </tr>
        ))}
      </Table>
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
        <Select style={inputStyle} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="admin">admin</option>
          <option value="manager">manager</option>
          <option value="member">member</option>
          <option value="viewer">viewer</option>
        </Select>
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

// ── Schedule (run the Agentic Tester on a cadence) ───────────────────────────

const CRON_PRESETS: { label: string; cron: string }[] = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Daily 08:00', cron: '0 8 * * *' },
  { label: 'Weekdays 08:00', cron: '0 8 * * 1-5' },
  { label: 'Weekly (Mon 08:00)', cron: '0 8 * * 1' },
];

function SchedulesSection({ projectId, schedules, credentials, busy, onRun }: {
  projectId: number; schedules: QaSchedule[]; credentials: QaCredential[]; busy: string | null;
  onRun: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [cron, setCron] = useState('0 8 * * *');
  const [credentialId, setCredentialId] = useState('');

  return (
    <Section title={`Schedule (${schedules.length})`}>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
        Run the Agentic Tester automatically — the platform enqueues a heatmap-driven exploration on this cadence (no CI needed).
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Select style={inputStyle} value={cron} onChange={(e) => setCron(e.target.value)}>
          {CRON_PRESETS.map((p) => <option key={p.cron} value={p.cron}>{p.label}</option>)}
        </Select>
        <Select style={inputStyle} value={credentialId} onChange={(e) => setCredentialId(e.target.value)}>
          <option value="">Default persona</option>
          {credentials.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
        <button type="button" style={btnStyle(busy != null)} disabled={busy != null}
          onClick={() => onRun('sched-add', () => createSchedule(projectId, { cron, credentialId: credentialId || undefined }))}>
          Schedule
        </button>
      </div>
      {schedules.length === 0 ? (
        <Empty>Not scheduled. Add a cadence to run QA automatically.</Empty>
      ) : (
        <Table head={['Cadence', 'Enabled', 'Next run', 'Last', '']}>
          {schedules.map((s) => (
            <tr key={s.id}>
              <Td><code style={{ fontSize: 11 }}>{s.cron}</code> <span style={{ color: 'var(--text-muted)' }}>{s.timezone}</span></Td>
              <Td>
                <button type="button" style={btnStyle(busy != null)} disabled={busy != null}
                  onClick={() => onRun(`sched-tog-${s.id}`, () => updateSchedule(s.id, { enabled: !s.enabled }))}>
                  {s.enabled ? 'On' : 'Off'}
                </button>
              </Td>
              <Td>{s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : '—'}</Td>
              <Td>{s.lastStatus ?? '—'}</Td>
              <Td><button type="button" style={btnStyle(busy != null)} disabled={busy != null} onClick={() => onRun(`sched-del-${s.id}`, () => deleteSchedule(s.id))}>Delete</button></Td>
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

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: '8px', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'top', ...style }}>{children}</td>;
}
