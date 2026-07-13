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
  fetchQualityTrend,
  fetchRouting,
  fetchRuns,
  fetchSchedules,
  fetchTargets,
  fetchTests,
  generateTest,
  seedCrawl,
  startExploration,
  updateRouting,
  updateSchedule,
  type QaCredential,
  type QaExploration,
  type QaFinding,
  type QaFlow,
  type QaHeatZone,
  type QaModelQuality,
  type QaQualityTrend,
  type QaRoutingSettings,
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
  const [routing, setRouting] = useState<QaRoutingSettings | null>(null);
  const [quality, setQuality] = useState<QaQualityTrend | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects().then(setProjects).catch(() => { /* projects optional for self-test */ });
  }, []);

  const reload = useCallback(async () => {
    try {
      const [f, t, r, hm, ex, q] = await Promise.all([
        fetchFlows(projectId), fetchTests(projectId), fetchRuns(projectId),
        fetchHeatmap({ limit: 40 }).catch(() => ({ zones: [] })),
        fetchExplorations(projectId).catch(() => ({ explorations: [] })),
        fetchQualityTrend(projectId).catch(() => ({ trend: null })),
      ]);
      setFlows(f.flows ?? []);
      setTests(t.tests ?? []);
      setRuns(r.runs ?? []);
      setHeatZones(hm.zones ?? []);
      setExplorations(ex.explorations ?? []);
      setQuality(q.trend ?? null);
      if (projectId != null) {
        const [tg, cr, sc, ro] = await Promise.all([
          fetchTargets(projectId), fetchCredentials(projectId),
          fetchSchedules(projectId).catch(() => ({ schedules: [] })),
          fetchRouting(projectId).catch(() => ({ settings: null })),
        ]);
        setTargets(tg.targets ?? []);
        setCredentials(cr.credentials ?? []);
        setSchedules(sc.schedules ?? []);
        setRouting(ro.settings ?? null);
      } else {
        setTargets([]);
        setCredentials([]);
        setSchedules([]);
        setRouting(null);
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

      <QualityTrendSection trend={quality} />

      {/* Targets + Credentials + Schedule + Auto-routing only apply to a selected project */}
      {projectId != null && (
        <>
          <TargetsSection projectId={projectId} targets={targets} busy={busy} onRun={run} />
          <CredentialsSection projectId={projectId} credentials={credentials} busy={busy} onRun={run} />
          <SchedulesSection projectId={projectId} schedules={schedules} credentials={credentials} busy={busy} onRun={run} />
          <RoutingSection projectId={projectId} settings={routing} busy={busy} onRun={run} />
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

// ── Quality trend (escaped defects + producing model/agent) ──────────────────

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function QualityTrendSection({ trend }: { trend: QaQualityTrend | null }) {
  if (!trend) {
    return (
      <Section title="Quality trend">
        <Empty>No quality data yet. It builds from Agentic Tester findings, CI build outcomes, and cloud-agent run scores.</Empty>
      </Section>
    );
  }
  const peakFindings = Math.max(1, ...trend.daily.map((d) => d.findings + d.ciFailures));
  return (
    <Section title={`Quality trend · last ${trend.windowDays}d`}>
      {/* Headline metrics */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Metric label="Quality score" value={trend.qualityScore != null ? pct(trend.qualityScore) : '—'}
          hint="mean cloud-agent run outcome" color={trend.qualityScore != null && trend.qualityScore < 0.5 ? '#f85149' : '#3fb950'} />
        <Metric label="Escaped defects" value={String(trend.findings.total)} hint={`${trend.findings.open} open`}
          color={trend.findings.open > 0 ? '#d29922' : 'var(--text-primary)'} />
        <Metric label="CI failure rate" value={trend.ci.builds > 0 ? pct(trend.ci.failureRate) : '—'}
          hint={`${trend.ci.failures}/${trend.ci.builds} builds`} color={trend.ci.failureRate > 0.2 ? '#f85149' : 'var(--text-primary)'} />
        <Metric label="Auto-routed" value={String(trend.findings.autoRouted)} hint="findings → fix agent" />
      </div>

      {/* Severity breakdown */}
      {trend.findings.total > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {SEVERITY_ORDER.filter((s) => trend.findings.bySeverity[s]).map((s) => (
            <span key={s} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border-subtle)', color: SEVERITY_COLOR[s] ?? 'var(--text-secondary)', fontWeight: 700 }}>
              {s}: {trend.findings.bySeverity[s]}
            </span>
          ))}
        </div>
      )}

      {/* Daily defect series (findings + CI failures, stacked bars) */}
      {trend.daily.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Defects per day (findings ▮ + CI failures ▮)</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 64 }}>
            {trend.daily.map((d) => (
              <div key={d.date} title={`${d.date}: ${d.findings} findings, ${d.ciFailures} CI failures`}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', minWidth: 4 }}>
                <span style={{ display: 'block', height: `${(d.ciFailures / peakFindings) * 100}%`, background: '#f85149', borderRadius: '2px 2px 0 0' }} />
                <span style={{ display: 'block', height: `${(d.findings / peakFindings) * 100}%`, background: '#d29922' }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Which model / agent produced the defects */}
      <ProducerTable title="By model" rows={trend.byModel} />
      <ProducerTable title="By agent" rows={trend.byAgent} />
      {(trend.byModel.length > 0 || trend.byAgent.length > 0) && (
        <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
          Caught = build-time defects (CI-failing runs). Escaped = runtime findings attributed to the most recent
          deploy before each finding{trend.findings.escapedUnattributed > 0 ? ` (${trend.findings.escapedUnattributed} unattributed)` : ''}.
        </p>
      )}
    </Section>
  );
}

function Metric({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <div style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-deep, #0d1117)', minWidth: 130 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? 'var(--text-primary)', lineHeight: 1.3 }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{hint}</div>}
    </div>
  );
}

function ProducerTable({ title, rows }: { title: string; rows: QaModelQuality[] }) {
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '10px 0 4px' }}>{title} — worst quality first</div>
      <Table head={['Producer', 'Runs', 'Avg score', 'Merged', 'CI green', 'Caught', 'Escaped']}>
        {rows.map((r) => (
          <tr key={r.key}>
            <Td><code style={{ fontSize: 11 }}>{r.key}</code></Td>
            <Td>{r.runs}</Td>
            <Td><span style={{ color: r.avgScore < 0.5 ? '#f85149' : 'var(--text-secondary)', fontWeight: 700 }}>{pct(r.avgScore)}</span></Td>
            <Td>{pct(r.mergedRate)}</Td>
            <Td><span style={{ color: r.ciGreenRate < 0.6 ? '#d29922' : 'var(--text-secondary)' }}>{pct(r.ciGreenRate)}</span></Td>
            <Td><span style={{ color: r.defects > 0 ? '#d29922' : 'var(--text-secondary)', fontWeight: 700 }}>{r.defects}</span></Td>
            <Td><span style={{ color: r.escapedDefects > 0 ? '#f85149' : 'var(--text-secondary)', fontWeight: 700 }}>{r.escapedDefects}</span></Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ── Auto-routing policy (findings → fix agent) ───────────────────────────────

function RoutingSection({ projectId, settings, busy, onRun }: {
  projectId: number; settings: QaRoutingSettings | null; busy: string | null;
  onRun: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const current: QaRoutingSettings = settings ?? { enabled: false, minSeverity: 'high', targetLaneKey: null, maxPerBatch: 5 };
  const [draft, setDraft] = useState<QaRoutingSettings>(current);

  // Keep the editor in sync when the loaded settings change (project switch / reload).
  useEffect(() => { setDraft(current); }, [settings, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = JSON.stringify(draft) !== JSON.stringify(current);

  return (
    <Section title="Auto-route findings to a fix agent">
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
        When enabled, a captured finding at/above the chosen severity automatically opens a board task and routes it
        into the project&apos;s staffed fix lane — firing the agent without waiting for manual triage. Off by default
        (auto-routing dispatches paid agent runs).
      </p>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
          Enabled
        </label>
        <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Min severity</label>
        <Select style={inputStyle} value={draft.minSeverity} onChange={(e) => setDraft({ ...draft, minSeverity: e.target.value })}>
          {SEVERITY_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Lane</label>
        <input style={inputStyle} placeholder="auto-detect" value={draft.targetLaneKey ?? ''}
          onChange={(e) => setDraft({ ...draft, targetLaneKey: e.target.value || null })} />
        <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Max / run</label>
        <input type="number" min={1} max={50} value={draft.maxPerBatch} style={{ ...inputStyle, minWidth: 64, width: 64 }}
          onChange={(e) => setDraft({ ...draft, maxPerBatch: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} />
        <button type="button" style={btnStyle(busy != null || !dirty)} disabled={busy != null || !dirty}
          onClick={() => onRun('routing-save', () => updateRouting(projectId, draft))}>
          {busy === 'routing-save' ? 'Saving…' : 'Save'}
        </button>
      </div>
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
