'use client';

import { Icon } from '@/components/ui/Icon';
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
import { useTranslations } from 'next-intl';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/types';
import { Empty, STATUS_COLOR, SEVERITY_COLOR, Section, Table, Td, btnStyle, inputStyle } from './qa/QaPrimitives';
import { QualityTrendSection, RoutingSection } from './qa/QaQualitySections';
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
  fetchFindingScreenshot,
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
import { useFormat } from "@/i18n/useFormat";

// Authenticated nav routes worth smoke-testing the Builderforce app itself
// (self-test crawl seed when no project is selected).
const SELF_TEST_ROUTES = [
  '/dashboard', '/projects', '/create', '/tasks', '/training',
  '/skills', '/personas', '/settings', '/workforce',
  '/workforce?tab=chats', '/workforce?tab=approvals',
];

export function QaContent() {
  const t = useTranslations('qa');
  const fmt = useFormat();
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
      const [f, ts, r, hm, ex, q] = await Promise.all([
        fetchFlows(projectId), fetchTests(projectId), fetchRuns(projectId),
        // The heat table follows the same project scope as everything else on
        // this tab — a workspace-wide ranking was showing one product's traffic
        // as the reason to test another's.
        fetchHeatmap({ limit: 40, projectId }).catch(() => ({ zones: [] })),
        fetchExplorations(projectId).catch(() => ({ explorations: [] })),
        fetchQualityTrend(projectId).catch(() => ({ trend: null })),
      ]);
      setFlows(f.flows ?? []);
      setTests(ts.tests ?? []);
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
      setError(e instanceof Error ? e.message : t('loadFailed'));
    }
  }, [projectId]);

  useEffect(() => { void reload(); }, [reload]);

  const run = useCallback(async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError(null);
    try { await fn(); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : t('actionFailed')); }
    finally { setBusy(null); }
  }, [reload]);

  const crawlRoutes = projectId != null
    ? (targets[0] ? ['/'] : []) // external site: crawl from root; refine once routes are known
    : SELF_TEST_ROUTES;

  return (
    <div>
      {/* Project selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('projectLabel')}</label>
        <Select
          value={projectId ?? ''}
          onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
          style={{ ...inputStyle, minWidth: 240 }}
        >
          <option value="">{t('selfTestOption')}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', marginBottom: 16, borderRadius: 'var(--radius-sm)', background: 'rgba(248,81,73,0.1)', color: 'var(--error)', fontSize: 12 }}>
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
        title={t('flowsTitle', { count: flows.length })}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            {projectId == null && (
              <button type="button" style={btnStyle(busy != null)} disabled={busy != null}
                onClick={() => run('agg', () => aggregateFlows(projectId))}>
                {busy === 'agg' ? t('aggregating') : t('aggregateFromUsage')}
              </button>
            )}
            <button type="button" style={btnStyle(busy != null || crawlRoutes.length === 0)} disabled={busy != null || crawlRoutes.length === 0}
              onClick={() => run('crawl', () => seedCrawl(crawlRoutes, projectId, projectId != null ? 'Site smoke crawl' : 'Authenticated route smoke crawl'))}>
              {busy === 'crawl' ? t('seeding') : t('seedAiCrawl')}
            </button>
          </div>
        }
      >
        {flows.length === 0 ? (
          <Empty>{projectId != null ? t('flowsEmptyProject') : t('flowsEmptySelfTest')}</Empty>
        ) : (
          <Table head={[t('colFlow'), t('colSource'), t('colPersona'), t('colSeen'), '']}>
            {flows.map((f) => (
              <tr key={f.id}>
                <Td><strong style={{ color: 'var(--text-primary)' }}>{f.name}</strong></Td>
                <Td>{f.source}</Td>
                <Td>{f.personaRole ?? '—'}</Td>
                <Td>{f.frequency || '—'}</Td>
                <Td>
                  <button type="button" style={btnStyle(busy != null)} disabled={busy != null}
                    onClick={() => run(`gen-${f.id}`, () => generateTest(f.id))}>
                    {busy === `gen-${f.id}` ? t('generating') : t('generateTest')}
                  </button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title={t('testsTitle', { count: tests.length })}>
        {tests.length === 0 ? (
          <Empty>{t('testsEmpty')}</Empty>
        ) : (
          <Table head={[t('colTest'), t('colPersona'), t('colModel'), t('colVer'), t('colStatus')]}>
            {tests.map((test) => (
              <tr key={test.id}>
                <Td><strong style={{ color: 'var(--text-primary)' }}>{test.name}</strong><br /><code style={{ fontSize: 10, color: 'var(--text-muted)' }}>{test.slug}</code></Td>
                <Td>{(test.credentialId ? credentials.find((c) => c.id === test.credentialId)?.label : null) ?? test.personaRole ?? '—'}</Td>
                <Td>{test.model ?? t('modelFallback')}</Td>
                <Td>v{test.version}</Td>
                <Td>{test.status}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title={t('runsTitle', { count: runs.length })}>
        {runs.length === 0 ? (
          <Empty>{t('runsEmpty')}</Empty>
        ) : (
          <Table head={[t('colTest'), t('colPersona'), t('colStatus'), t('colSteps'), t('colDuration'), t('colWhen')]}>
            {runs.map((r) => (
              <tr key={r.id}>
                <Td>{r.testName ?? r.testSlug ?? '—'}</Td>
                <Td>{r.credentialLabel ?? r.credentialRole ?? '—'}</Td>
                <Td><span style={{ color: STATUS_COLOR[r.status] ?? 'var(--text-secondary)', fontWeight: 700 }}>{r.status}</span></Td>
                <Td>{r.passedSteps != null && r.totalSteps != null ? `${r.passedSteps}/${r.totalSteps}` : '—'}</Td>
                <Td>{r.durationMs != null ? t('durationSeconds', { seconds: (r.durationMs / 1000).toFixed(1) }) : '—'}</Td>
                <Td>{fmt.dateTime(r.createdAt)}</Td>
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
  const t = useTranslations('qa');
  const fmt = useFormat();
  const [budget, setBudget] = useState(20);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Section
      title={t('agenticTesterTitle')}
      action={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('zonesLabel')}</label>
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
            {busy === 'explore-start' ? t('queuing') : t('runAgenticTester')}
          </button>
        </div>
      }
    >
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
        {t.rich('agenticTesterBlurb', { strong: (c) => <strong>{c}</strong> })}
      </p>

      {/* Heatmap — the hottest zones the next run will prioritise. */}
      {heatZones.length === 0 ? (
        <Empty>{t('heatmapEmpty')}</Empty>
      ) : (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{t('hottestZones', { count: heatZones.length })}</div>
          <Table head={[t('colRoute'), t('colElement'), t('colKind'), t('colHeat')]}>
            {heatZones.slice(0, 8).map((z, i) => (
              <tr key={`${z.route}-${z.selector ?? i}`}>
                <Td><code style={{ fontSize: 11 }}>{z.route}</code></Td>
                <Td>{z.label ?? (z.selector ? <code style={{ fontSize: 10 }}>{z.selector.slice(0, 48)}</code> : t('zonePageFallback'))}</Td>
                <Td>{z.kind}</Td>
                <Td><HeatBar heat={z.heat} max={heatZones[0]?.heat ?? 1} /></Td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {/* Explorations — the runs and their findings. */}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '18px 0 6px' }}>{t('explorationsCount', { count: explorations.length })}</div>
      {explorations.length === 0 ? (
        <Empty>{t('explorationsEmpty')}</Empty>
      ) : (
        <Table head={[t('colWhen'), t('colStatus'), t('colZones'), t('colFindings'), t('colSummary'), '']}>
          {explorations.map((ex) => (
            <tr key={ex.id}>
              <Td>{fmt.dateTime(ex.createdAt)}</Td>
              <Td><span style={{ color: STATUS_COLOR[ex.status] ?? 'var(--text-secondary)', fontWeight: 700 }}>{ex.status}</span></Td>
              <Td>{ex.zonesExplored != null ? `${ex.zonesExplored}/${ex.zonesPlanned}` : ex.zonesPlanned}</Td>
              <Td>{ex.findingsCount}</Td>
              <Td style={{ maxWidth: 280 }}>{ex.summary ?? ex.errorMessage ?? '—'}</Td>
              <Td>
                <button type="button" style={btnStyle(busy != null)} disabled={busy != null}
                  onClick={() => setOpenId(openId === ex.id ? null : ex.id)}>
                  {openId === ex.id ? t('hide') : t('colFindings')}
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
      <span style={{ display: 'inline-block', width: 60, height: 6, borderRadius: 'var(--radius-sm)', background: 'var(--border-subtle)' }}>
        <span style={{ display: 'block', width: `${pct}%`, height: 6, borderRadius: 'var(--radius-sm)', background: 'var(--amber-bright)' }} />
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{heat}</span>
    </span>
  );
}

/**
 * The page image captured when a finding was recorded.
 *
 * Loaded ON DEMAND rather than with the table: a run can carry a dozen
 * screenshots and a findings list is scanned far more often than any one image
 * is looked at. The read is authenticated, so it goes through the shared
 * transport and yields a blob URL — revoked on unmount so a long QA session does
 * not leak object URLs.
 */
function FindingScreenshot({ screenshotKey }: { screenshotKey: string }) {
  const t = useTranslations('qa');
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" title={t('screenshotOpenFull')}>
        <img
          src={url}
          alt={t('screenshotAlt')}
          style={{
            display: 'block', width: 160, maxWidth: '100%', height: 'auto',
            borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)',
          }}
        />
      </a>
    );
  }

  return (
    <button
      type="button"
      style={btnStyle(state === 'loading')}
      disabled={state === 'loading'}
      onClick={async () => {
        setState('loading');
        try {
          setUrl(await fetchFindingScreenshot(screenshotKey));
          setState('idle');
        } catch {
          setState('error');
        }
      }}
    >
      {state === 'loading' ? t('screenshotLoading') : state === 'error' ? t('screenshotUnavailable') : t('screenshotView')}
    </button>
  );
}

function FindingsPanel({ explorationId, busy, onRun }: {
  explorationId: string;
  busy: string | null;
  onRun: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const t = useTranslations('qa');
  const [findings, setFindings] = useState<QaFinding[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchExploration(explorationId);
      setFindings(res.findings ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('findingsLoadFailed'));
    }
  }, [explorationId]);

  useEffect(() => { void load(); }, [load]);

  if (loadError) return <Empty>{loadError}</Empty>;
  if (findings == null) return <Empty>{t('findingsLoading')}</Empty>;
  if (findings.length === 0) return <Empty>{t('findingsNone')} <Icon source="🎉" size="1em" /></Empty>;

  return (
    <div style={{ marginTop: 12, padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-deep)' }}>
      <Table head={[t('colSeverity'), t('colType'), t('colRoute'), t('colHeat'), t('colMessage'), t('colEvidence'), '']}>
        {findings.map((f) => (
          <tr key={f.id}>
            <Td><span style={{ color: SEVERITY_COLOR[f.severity] ?? 'var(--text-secondary)', fontWeight: 700 }}>{f.severity}</span></Td>
            <Td>{f.type}</Td>
            <Td><code style={{ fontSize: 10 }}>{f.route ?? '—'}</code></Td>
            <Td>{f.heat}</Td>
            <Td style={{ maxWidth: 360 }}><code style={{ fontSize: 11 }}>{f.message.slice(0, 200)}</code></Td>
            <Td>
              {f.screenshotKey
                ? <FindingScreenshot screenshotKey={f.screenshotKey} />
                : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>}
            </Td>
            <Td>
              {f.taskId ? (
                <span style={{ fontSize: 11, color: 'var(--success)' }}>{t('taskRef', { id: f.taskId })}</span>
              ) : f.projectId == null ? (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('selfTest')}</span>
              ) : (
                <button type="button" style={btnStyle(busy != null)} disabled={busy != null}
                  onClick={() => onRun(`finding-task-${f.id}`, async () => { await createTaskFromFinding(f.id); await load(); })}>
                  {busy === `finding-task-${f.id}` ? t('creating') : t('createTask')}
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
  const t = useTranslations('qa');
  const [name, setName] = useState('Production');
  const [baseUrl, setBaseUrl] = useState('');

  return (
    <Section title={t('targetsTitle', { count: targets.length })}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input style={inputStyle} placeholder={t('placeholderName')} value={name} onChange={(e) => setName(e.target.value)} />
        <input style={{ ...inputStyle, minWidth: 280 }} placeholder="https://app.example.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        <button type="button" style={btnStyle(busy != null || !baseUrl)} disabled={busy != null || !baseUrl}
          onClick={() => onRun('target-add', () => createTarget(projectId, { name, baseUrl, isDefault: targets.length === 0 }))}>
          {t('addTarget')}
        </button>
      </div>
      {targets.length === 0 ? (
        <Empty>{t('targetsEmpty')}</Empty>
      ) : (
        <Table head={[t('colName'), t('colBaseUrl'), t('colDefault'), '']}>
          {targets.map((target) => (
            <tr key={target.id}>
              <Td>{target.name}</Td>
              <Td><code style={{ fontSize: 11 }}>{target.baseUrl}</code></Td>
              <Td>{target.isDefault ? <Icon source="★" size="1em" /> : ''}</Td>
              <Td><button type="button" style={btnStyle(busy != null)} disabled={busy != null} onClick={() => onRun(`target-del-${target.id}`, () => deleteTarget(target.id))}>{t('deleteLabel')}</button></Td>
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
  const t = useTranslations('qa');
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
    <Section title={t('credentialsTitle', { count: credentials.length })}>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
        {t('credentialsBlurb')}
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input style={inputStyle} placeholder={t('placeholderLabel')} value={label} onChange={(e) => setLabel(e.target.value)} />
        <Select style={inputStyle} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="admin">admin</option>
          <option value="manager">manager</option>
          <option value="member">member</option>
          <option value="viewer">viewer</option>
        </Select>
        <input style={inputStyle} placeholder={t('placeholderUsername')} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        <input style={inputStyle} type="password" placeholder={t('placeholderPassword')} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        <input style={inputStyle} placeholder="/login" value={loginUrl} onChange={(e) => setLoginUrl(e.target.value)} />
        <button type="button" style={btnStyle(busy != null || !label || !username || !password)} disabled={busy != null || !label || !username || !password} onClick={add}>
          {t('addPersona')}
        </button>
      </div>
      {credentials.length === 0 ? (
        <Empty>{t('credentialsEmpty')}</Empty>
      ) : (
        <Table head={[t('colLabel'), t('colRole'), t('colUsername'), t('colLoginUrl'), '']}>
          {credentials.map((c) => (
            <tr key={c.id}>
              <Td><strong style={{ color: 'var(--text-primary)' }}>{c.label}</strong></Td>
              <Td>{c.role ?? '—'}</Td>
              <Td><code style={{ fontSize: 11 }}>{c.username}</code></Td>
              <Td><code style={{ fontSize: 11 }}>{c.loginUrl ?? '/login'}</code></Td>
              <Td><button type="button" style={btnStyle(busy != null)} disabled={busy != null} onClick={() => onRun(`cred-del-${c.id}`, () => deleteCredential(c.id))}>{t('deleteLabel')}</button></Td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

// ── Schedule (run the Agentic Tester on a cadence) ───────────────────────────

// Labels are message keys in the `qa` namespace — resolved at render, where the
// translator is available (a module-level const cannot call hooks).
const CRON_PRESETS: { labelKey: string; cron: string }[] = [
  { labelKey: 'cronEveryHour', cron: '0 * * * *' },
  { labelKey: 'cronDaily8', cron: '0 8 * * *' },
  { labelKey: 'cronWeekdays8', cron: '0 8 * * 1-5' },
  { labelKey: 'cronWeeklyMon8', cron: '0 8 * * 1' },
];

function SchedulesSection({ projectId, schedules, credentials, busy, onRun }: {
  projectId: number; schedules: QaSchedule[]; credentials: QaCredential[]; busy: string | null;
  onRun: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const t = useTranslations('qa');
  const fmt = useFormat();
  const [cron, setCron] = useState('0 8 * * *');
  const [credentialId, setCredentialId] = useState('');

  return (
    <Section title={t('scheduleTitle', { count: schedules.length })}>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
        {t('scheduleBlurb')}
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Select style={inputStyle} value={cron} onChange={(e) => setCron(e.target.value)}>
          {CRON_PRESETS.map((p) => <option key={p.cron} value={p.cron}>{t(p.labelKey)}</option>)}
        </Select>
        <Select style={inputStyle} value={credentialId} onChange={(e) => setCredentialId(e.target.value)}>
          <option value="">{t('defaultPersona')}</option>
          {credentials.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
        <button type="button" style={btnStyle(busy != null)} disabled={busy != null}
          onClick={() => onRun('sched-add', () => createSchedule(projectId, { cron, credentialId: credentialId || undefined }))}>
          {t('scheduleButton')}
        </button>
      </div>
      {schedules.length === 0 ? (
        <Empty>{t('scheduleEmpty')}</Empty>
      ) : (
        <Table head={[t('colCadence'), t('enabled'), t('colNextRun'), t('colLast'), '']}>
          {schedules.map((s) => (
            <tr key={s.id}>
              <Td><code style={{ fontSize: 11 }}>{s.cron}</code> <span style={{ color: 'var(--text-muted)' }}>{s.timezone}</span></Td>
              <Td>
                <button type="button" style={btnStyle(busy != null)} disabled={busy != null}
                  onClick={() => onRun(`sched-tog-${s.id}`, () => updateSchedule(s.id, { enabled: !s.enabled }))}>
                  {s.enabled ? t('on') : t('off')}
                </button>
              </Td>
              <Td>{s.nextRunAt ? fmt.dateTime(s.nextRunAt) : '—'}</Td>
              <Td>{s.lastStatus ?? '—'}</Td>
              <Td><button type="button" style={btnStyle(busy != null)} disabled={busy != null} onClick={() => onRun(`sched-del-${s.id}`, () => deleteSchedule(s.id))}>{t('deleteLabel')}</button></Td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}
