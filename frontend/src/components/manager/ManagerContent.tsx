'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Select } from '@/components/Select';
import { RoleGate } from '@/components/RoleGate';
import PillTabs, { type PillTab } from '@/components/PillTabs';
import { usePermission } from '@/lib/rbac';
import { BarChart, type BarDatum } from '@/components/charts/BarChart';
import {
  managerApi,
  agentHosts,
  workflowDefinitions,
  tasksApi,
  type ManagerOverview,
  type ManagerConfigPatch,
  type ManagerAction,
  type ManagerActionType,
  type ManagerBacklogItem,
  type ManagerRunTask,
  type PrMergePolicy,
  type TaskPriority,
  type AgentHost,
} from '@/lib/builderforceApi';
import type { CloudAgentTarget, TeamMember } from '@/lib/taskAssignee';
import { assigneeName } from '@/lib/taskAssignee';
import {
  tableWrapStyle,
  tableStyle,
  theadRowStyle,
  thStyle,
  trStyle,
  tdStyle,
  tdMutedStyle,
} from '@/components/dataTableStyles';

/**
 * AI Manager — the per-project backlog manager surface. It reads the manager
 * overview (config + effective policy + stats + ranked backlog + activity feed),
 * lets a manager designate who runs the backlog and how (auto-score value,
 * auto-assign, auto-prioritize, PR-merge policy), and triggers a run on demand.
 *
 * The surface is split into sub-views by the shared <PillTabs> bar (the same
 * secondary nav Settings / Security use), driven by `?sub=` so each view is
 * deep-linkable: Overview ('') · Backlog · Activity · Policy. The header and the
 * data/polling effects live above the switch so a run keeps streaming whichever
 * sub-view is open.
 *
 * Access to EDIT the policy / trigger a run is gated on `manager.manage`
 * (manager role); the server is the real authority. Everything else is readable
 * by anyone in the workspace. Fully localized + themed (light/dark) + responsive.
 */

const PRIORITY_BADGE: Record<TaskPriority, string> = {
  low: 'badge-gray',
  medium: 'badge-blue',
  high: 'badge-yellow',
  urgent: 'badge-red',
};
const PRIORITIES: TaskPriority[] = ['urgent', 'high', 'medium', 'low'];
const PR_POLICIES: PrMergePolicy[] = ['immediate', 'on_green', 'queue'];
const ACTION_ICON: Record<ManagerActionType, string> = {
  prioritize: '📊',
  assign: '👤',
  score_value: '💎',
  dispatch: '🚀',
  sync_pr: '🔄',
  merge_pr: '🔀',
  flag: '🚩',
  coordinate: '🧭',
};

// ── Shared inline styles (all colours from theme vars → light + dark safe) ──
const panelStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};
const sectionTitleStyle: CSSProperties = { fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' };
const mutedStyle: CSSProperties = { color: 'var(--text-muted)', fontSize: '0.8rem' };
const controlStyle: CSSProperties = {
  padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.85rem', minWidth: 220, maxWidth: '100%',
};
const primaryBtn: CSSProperties = {
  padding: '9px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
  background: 'var(--accent, #2563eb)', color: '#fff', fontWeight: 700, fontSize: '0.85rem',
};

export interface ManagerContentProps {
  projectId?: number;
}

export function ManagerContent({ projectId }: ManagerContentProps) {
  const t = useTranslations('manager');
  const format = useFormatter();
  const { allowed: canManage } = usePermission('manager.manage');
  // Sub-view is URL state (`?sub=`), not local state, so every view is
  // deep-linkable and the back button works — same convention as /settings.
  const sub = useSearchParams().get('sub') ?? '';

  const [data, setData] = useState<ManagerOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  // Coaching-session state (the human directs the manager).
  const [coachText, setCoachText] = useState('');
  const [coachScope, setCoachScope] = useState<'project' | 'tenant'>('project');
  const [coachMode, setCoachMode] = useState<'directive' | 'task'>('directive');
  const [coachExpiryDays, setCoachExpiryDays] = useState('');
  const [coaching, setCoaching] = useState(false);
  // Assignee pools that back the "who manages this" designation select.
  const [hosts, setHosts] = useState<AgentHost[]>([]);
  const [cloudAgents, setCloudAgents] = useState<CloudAgentTarget[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);

  const relative = useCallback(
    (iso: string | null): string => {
      if (!iso) return '';
      try {
        return format.relativeTime(new Date(iso), new Date());
      } catch {
        return new Date(iso).toLocaleString();
      }
    },
    [format],
  );

  const load = useCallback(async () => {
    if (projectId == null) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [overview, hostsData, runTargets, membersData] = await Promise.all([
        managerApi.get(projectId),
        agentHosts.list().catch(() => [] as AgentHost[]),
        workflowDefinitions.runTargets().catch(() => ({ hosts: [], cloudAgents: [] })),
        tasksApi.assignees().catch(() => [] as TeamMember[]),
      ]);
      setData(overview);
      setHosts(hostsData);
      setCloudAgents(runTargets.cloudAgents);
      setMembers(membersData);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error.body'));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => { void load(); }, [load]);

  const savePatch = useCallback(async (patch: ManagerConfigPatch) => {
    if (projectId == null) return;
    setSaving(true);
    try {
      await managerApi.update(projectId, patch);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error.body'));
    } finally {
      setSaving(false);
    }
  }, [projectId, load, t]);

  // The manager pass now runs in the background on the server (it is far too heavy to
  // finish inside one request). We poll the overview while it runs so every decision
  // it journals streams into the activity feed + stats live. The pass stamps
  // `lastRunAt` when it finishes; we stop once that advances past the baseline, or
  // after a hard cap (an evicted run leaves the partial actions we already streamed
  // in place, and the next run resumes). Cancels on unmount.
  const pollingRef = useRef(false);
  useEffect(() => () => { pollingRef.current = false; }, []);

  // Background refresh so a CRON manager pass (every ~5 min) shows up live on this
  // tab — not only when the human clicked "Run manager now". Paused while a manual
  // run is already streaming (streamUntilDone polls then) to avoid double-loading.
  useEffect(() => {
    if (projectId == null) return;
    const id = setInterval(() => { if (!pollingRef.current) void load(); }, 20000);
    return () => clearInterval(id);
  }, [projectId, load]);

  const streamUntilDone = useCallback(async (baseline: string | null) => {
    pollingRef.current = true;
    const startedAt = Date.now();
    const MAX_MS = 120_000;
    const INTERVAL_MS = 3000;
    while (pollingRef.current && projectId != null) {
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
      if (!pollingRef.current) break;
      try {
        const overview = await managerApi.get(projectId);
        setData(overview);
        if (overview.stats.lastRunAt && overview.stats.lastRunAt !== baseline) break;
      } catch { /* transient — keep polling */ }
      if (Date.now() - startedAt > MAX_MS) break;
    }
    pollingRef.current = false;
    setRunning(false);
  }, [projectId]);

  const runNow = useCallback(async () => {
    if (projectId == null || running) return;
    setError(null);
    setRunning(true);
    const baseline = data?.stats.lastRunAt ?? null;
    let started = false;
    try {
      const res = await managerApi.run(projectId);
      started = res.started;
      if (!started) setError(t('disabledNotice'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error.body'));
    }
    if (started) void streamUntilDone(baseline);
    else setRunning(false);
  }, [projectId, running, data, streamUntilDone, t]);

  const memberName = useCallback(
    (userId: string | null, ref: string | null, hostId: number | null) =>
      assigneeName(hostId, ref, userId, hosts, cloudAgents, members),
    [hosts, cloudAgents, members],
  );

  const coachNow = useCallback(async () => {
    if (projectId == null || coaching) return;
    const directive = coachText.trim();
    if (directive.length < 3) return;
    setCoaching(true);
    setError(null);
    try {
      const days = Number(coachExpiryDays);
      await managerApi.coach(projectId, {
        directive,
        mode: coachMode,
        ...(coachMode === 'directive'
          ? { scope: coachScope, ...(Number.isFinite(days) && days > 0 ? { expiresInDays: days } : {}) }
          : {}),
      });
      setCoachText('');
      setCoachExpiryDays('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error.body'));
    } finally {
      setCoaching(false);
    }
  }, [projectId, coaching, coachText, coachMode, coachScope, coachExpiryDays, load, t]);

  const setDirectiveStatus = useCallback(async (id: string, status: 'dismissed' | 'done') => {
    if (projectId == null) return;
    try {
      await managerApi.dismissDirective(projectId, id, status);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error.body'));
    }
  }, [projectId, load, t]);

  // ── Empty / loading / error states (all localized) ──
  if (projectId == null) {
    return <Notice title={t('noProject.title')} body={t('noProject.body')} />;
  }
  if (loading && !data) {
    return <Notice title={t('loading')} body="" muted />;
  }
  if (error && !data) {
    return <Notice title={t('error.title')} body={error} retryLabel={t('error.retry')} onRetry={load} />;
  }
  if (!data) return null;

  const { policy, stats, backlog, actions, runTasks, autonomy, managerTypes, directives } = data;
  const managerValue = policy.managerRef ?? '';
  const capWindow = autonomy?.reason === 'monthly_exhausted' ? 'monthly' : 'daily';
  const activeDirectives = directives.filter((d) => d.status === 'active');

  // A manager type is a built-in DOMAIN (localized by id) or a tenant CUSTOM-role type
  // (`role:<key>`, rendered by its tenant-authored label). One helper keeps the two
  // sources one concept in the UI.
  const isBuiltinType = (id: string) => !id.startsWith('role:');
  const typeLabel = (mt: { id: string; label: string }) =>
    isBuiltinType(mt.id) ? t(`type.${mt.id}.label`) : mt.label;
  const currentType = managerTypes.find((m) => m.id === policy.managerType);
  const currentTypeDescription = currentType
    ? (isBuiltinType(currentType.id) ? t(`type.${currentType.id}.description`) : currentType.description)
    : '';

  const priorityChart: BarDatum[] = PRIORITIES.map((p) => ({
    key: p,
    label: t(`priority.${p}`),
    value: backlog.filter((b) => b.priority === p).length,
  })).filter((d) => d.value > 0);

  // Sub-views. Policy is only offered to a manager (the panels inside it are
  // `manager.manage`-gated anyway, and the server is the real authority — a
  // deep link to ?sub=policy still renders RoleGate's block notice).
  const href = (id: string) => (id ? `/projects?tab=manager&sub=${id}` : '/projects?tab=manager');
  const subTabs: PillTab[] = [
    { id: '', label: t('subnav.overview'), icon: '📊', href: href('') },
    { id: 'backlog', label: t('subnav.backlog'), icon: '📋', href: href('backlog') },
    { id: 'activity', label: t('subnav.activity'), icon: '📡', href: href('activity') },
    ...(canManage ? [{ id: 'policy', label: t('subnav.policy'), icon: '⚙️', href: href('policy') }] : []),
  ];
  // Unknown/stale `?sub=` values fall back to Overview rather than a blank page.
  const activeSub = subTabs.some((s) => s.id === sub) ? sub : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span aria-hidden>🧭</span> {t('title')}
          </h1>
          <p style={{ margin: '6px 0 0', ...mutedStyle, maxWidth: 640 }}>{t('subtitle')}</p>
          <p style={{ margin: '4px 0 0', ...mutedStyle }}>
            {stats.lastRunAt ? t('lastManaged', { when: relative(stats.lastRunAt) }) : t('neverManaged')}
          </p>
        </div>
        <RoleGate capability="manager.manage">
          <button
            type="button"
            style={{ ...primaryBtn, opacity: running ? 0.7 : 1 }}
            disabled={running}
            onClick={runNow}
          >
            {running ? t('running') : t('runNow')}
          </button>
        </RoleGate>
      </div>

      {error && data && (
        <div style={{ ...panelStyle, borderColor: 'var(--danger, #dc2626)', color: 'var(--danger, #dc2626)', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {/* Autonomy paused — the cron manager sweep + executor gate on the tenant's
          token budget and skip a capped tenant, so the board (and its Evermind
          learning) freezes with no on-surface reason. Surface it: only manual runs
          work while blocked. */}
      {autonomy?.tokenBlocked && (
        <div
          role="alert"
          style={{
            ...panelStyle,
            display: 'flex', alignItems: 'flex-start', gap: 10,
            borderColor: 'var(--warning-fg, #b45309)',
            background: 'var(--warning-bg, rgba(180, 83, 9, 0.08))',
          }}
        >
          <span aria-hidden style={{ fontSize: '1.1rem', lineHeight: '1.3rem' }}>⏸️</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--warning-fg, #b45309)' }}>
              {t('autonomyPaused.title')}
            </div>
            <div style={{ ...mutedStyle, marginTop: 4 }}>
              {t(`autonomyPaused.${capWindow}`)}
            </div>
          </div>
        </div>
      )}

      {/* ── Secondary nav (shared pill bar, same as /settings) ── */}
      <PillTabs tabs={subTabs} activeId={activeSub} ariaLabel={t('subnav.label')} style={{ marginBottom: 0 }} />

      {/* The run pulse animation is declared once at the root so it survives a
          sub-view switch (it is consumed by the Activity view's live badge). */}
      <style>{'@keyframes bf-pulse{0%,100%{opacity:.35}50%{opacity:1}}'}</style>

      {activeSub === '' && (
      <>
      {/* ── Stats tiles + priority chart ── */}
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <StatTile label={t('stat.total')} value={stats.total} />
        <StatTile label={t('stat.unscored')} value={stats.unscored} tone={stats.unscored > 0 ? 'warn' : undefined} />
        <StatTile label={t('stat.unranked')} value={stats.unranked} tone={stats.unranked > 0 ? 'warn' : undefined} />
        <StatTile label={t('stat.unowned')} value={stats.unowned} tone={stats.unowned > 0 ? 'warn' : undefined} />
        <StatTile label={t('stat.openPullRequests')} value={stats.openPullRequests} />
      </div>

      <div style={panelStyle}>
        <div style={{ ...sectionTitleStyle, marginBottom: 4 }}>{t('chart.title')}</div>
        <div style={{ ...mutedStyle, marginBottom: 12 }}>{t('chart.caption')}</div>
        {priorityChart.length > 0 ? (
          <BarChart data={priorityChart} ariaLabel={t('chart.title')} labelWidth={80} />
        ) : (
          <div style={mutedStyle}>{t('chart.empty')}</div>
        )}
        {(stats.unscored > 0 || stats.unranked > 0) && (
          <div style={{ marginTop: 12, fontSize: '0.8rem', color: 'var(--warning-fg, #b45309)' }}>
            💡 {t('insightNudge', { unscored: stats.unscored, unranked: stats.unranked })}
          </div>
        )}
      </div>
      </>
      )}

      {activeSub === 'policy' && (
      <>
      {/* ── Policy panel ── */}
      <RoleGate capability="manager.manage" variant="block">
        <div style={panelStyle}>
          <div style={{ ...sectionTitleStyle, marginBottom: 4 }}>{t('policy.title')}</div>
          <div style={{ ...mutedStyle, marginBottom: 16 }}>{t('policy.subtitle')}</div>

          {/* Designate the manager */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: 4 }}>
              {t('policy.manager.label')}
            </label>
            <div style={{ ...mutedStyle, marginBottom: 8 }}>{t('policy.manager.help')}</div>
            <Select
              value={managerValue}
              disabled={saving}
              onChange={(e) => savePatch({ managerRef: e.target.value })}
              style={controlStyle}
            >
              <option value="">{t('policy.manager.system')}</option>
              {members.length > 0 && (
                <optgroup label={t('policy.manager.people')}>
                  {members.map((m) => (
                    <option key={`u:${m.id}`} value={`u:${m.id}`}>{m.name}</option>
                  ))}
                </optgroup>
              )}
              {cloudAgents.length > 0 && (
                <optgroup label={t('policy.manager.agents')}>
                  {cloudAgents.map((a) => (
                    <option key={`c:${a.ref}`} value={`c:${a.ref}`}>{a.name}</option>
                  ))}
                </optgroup>
              )}
              {hosts.length > 0 && (
                <optgroup label={t('policy.manager.hosts')}>
                  {hosts.map((h) => (
                    <option key={`h:${h.id}`} value={`h:${h.id}`}>{h.name}</option>
                  ))}
                </optgroup>
              )}
            </Select>
          </div>

          {/* Manager TYPE / role — Development, QA, Service Desk, DevOps … */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: 4 }}>
              {t('type.label')}
            </label>
            <div style={{ ...mutedStyle, marginBottom: 8 }}>{t('type.help')}</div>
            <Select
              value={policy.managerType}
              disabled={saving}
              onChange={(e) => savePatch({ managerType: e.target.value as typeof policy.managerType })}
              style={controlStyle}
            >
              {managerTypes.map((mt) => (
                <option key={mt.id} value={mt.id}>{typeLabel(mt)}</option>
              ))}
            </Select>
            {currentTypeDescription && (
              <div style={{ ...mutedStyle, marginTop: 8 }}>{currentTypeDescription}</div>
            )}
            {currentType?.roleKey && (
              <div style={{ ...mutedStyle, marginTop: 6, fontSize: '0.72rem' }}>
                {t('type.fillsRole', { role: currentType.roleKey })}
              </div>
            )}
          </div>

          {/* Toggles */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 20 }}>
            <ToggleRow
              label={t('policy.enabled.label')} help={t('policy.enabled.help')}
              checked={policy.enabled} disabled={saving}
              onChange={(v) => savePatch({ enabled: v })}
            />
            <ToggleRow
              label={t('policy.autoBusinessValue.label')} help={t('policy.autoBusinessValue.help')}
              checked={policy.autoBusinessValue} disabled={saving}
              onChange={(v) => savePatch({ autoBusinessValue: v })}
            />
            <ToggleRow
              label={t('policy.autoPrioritize.label')} help={t('policy.autoPrioritize.help')}
              checked={policy.autoPrioritize} disabled={saving}
              onChange={(v) => savePatch({ autoPrioritize: v })}
            />
            <ToggleRow
              label={t('policy.autoAssign.label')} help={t('policy.autoAssign.help')}
              checked={policy.autoAssign} disabled={saving}
              onChange={(v) => savePatch({ autoAssign: v })}
            />
          </div>

          {/* PR-merge policy segmented control */}
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: 4 }}>
              {t('policy.prMerge.label')}
            </div>
            <div style={{ ...mutedStyle, marginBottom: 8 }}>{t('policy.prMerge.help')}</div>
            <div role="radiogroup" style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6, border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 4 }}>
              {PR_POLICIES.map((p) => {
                const active = policy.prMergePolicy === p;
                return (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={saving}
                    onClick={() => savePatch({ prMergePolicy: p })}
                    title={t(`policy.prMerge.${p}.help`)}
                    style={{
                      padding: '7px 12px', borderRadius: 7, border: 'none', cursor: saving ? 'default' : 'pointer',
                      background: active ? 'var(--accent, #2563eb)' : 'transparent',
                      color: active ? '#fff' : 'var(--text-secondary)', fontWeight: 600, fontSize: '0.82rem',
                    }}
                  >
                    {t(`policy.prMerge.${p}.label`)}
                  </button>
                );
              })}
            </div>
            <div style={{ ...mutedStyle, marginTop: 8 }}>{t(`policy.prMerge.${policy.prMergePolicy}.help`)}</div>
          </div>
        </div>
      </RoleGate>

      {/* ── Coaching session — the human directs the manager ── */}
      <RoleGate capability="manager.manage" variant="block">
        <div style={panelStyle}>
          <div style={{ ...sectionTitleStyle, marginBottom: 4 }}>{t('coaching.title')}</div>
          <div style={{ ...mutedStyle, marginBottom: 12 }}>
            {coachMode === 'task' ? t('coaching.taskHint') : t('coaching.subtitle')}
          </div>

          {/* Mode — standing directive vs a one-off task the manager executes once. */}
          <div role="radiogroup" aria-label={t('coaching.modeLabel')} style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6, border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 4, marginBottom: 10 }}>
            {(['directive', 'task'] as const).map((m) => {
              const active = coachMode === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setCoachMode(m)}
                  style={{
                    padding: '7px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
                    background: active ? 'var(--accent, #2563eb)' : 'transparent',
                    color: active ? '#fff' : 'var(--text-secondary)', fontWeight: 600, fontSize: '0.82rem',
                  }}
                >
                  {t(`coaching.mode${m === 'task' ? 'Task' : 'Directive'}`)}
                </button>
              );
            })}
          </div>

          <textarea
            value={coachText}
            onChange={(e) => setCoachText(e.target.value)}
            placeholder={coachMode === 'task' ? t('coaching.taskPlaceholder') : t('coaching.placeholder')}
            rows={3}
            style={{ ...controlStyle, width: '100%', minWidth: 0, resize: 'vertical', fontFamily: 'inherit' }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 10 }}>
            {coachMode === 'directive' && (
              <>
                <Select
                  value={coachScope}
                  onChange={(e) => setCoachScope(e.target.value as 'project' | 'tenant')}
                  style={{ ...controlStyle, minWidth: 180 }}
                  aria-label={t('coaching.scopeLabel')}
                >
                  <option value="project">{t('coaching.scopeProject')}</option>
                  <option value="tenant">{t('coaching.scopeTenant')}</option>
                </Select>
                <input
                  type="number"
                  min={0}
                  value={coachExpiryDays}
                  onChange={(e) => setCoachExpiryDays(e.target.value)}
                  placeholder={t('coaching.expiryPlaceholder')}
                  aria-label={t('coaching.expiryLabel')}
                  style={{ ...controlStyle, width: 150 }}
                />
              </>
            )}
            <button
              type="button"
              style={{ ...primaryBtn, opacity: coaching || coachText.trim().length < 3 ? 0.6 : 1 }}
              disabled={coaching || coachText.trim().length < 3}
              onClick={coachNow}
            >
              {coaching ? t('coaching.sending') : coachMode === 'task' ? t('coaching.taskSubmit') : t('coaching.submit')}
            </button>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: 8 }}>
              {t('coaching.activeTitle')}
            </div>
            {activeDirectives.length === 0 ? (
              <div style={mutedStyle}>{t('coaching.empty')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {activeDirectives.map((d) => (
                  <div
                    key={d.id}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px',
                      border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-base)',
                    }}
                  >
                    <span aria-hidden style={{ flexShrink: 0 }}>🎯</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{d.directive}</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {d.projectId == null && (
                          <span style={{ ...mutedStyle, fontSize: '0.72rem' }}>{t('coaching.tenantWide')}</span>
                        )}
                        <span style={{ ...mutedStyle, fontSize: '0.72rem' }}>
                          {d.expiresAt ? t('coaching.expiresAt', { when: relative(d.expiresAt) }) : t('coaching.noExpiry')}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={() => setDirectiveStatus(d.id, 'done')}
                        title={t('coaching.markDone')}
                        aria-label={t('coaching.markDone')}
                        style={{
                          background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 6,
                          color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 8px', fontSize: '0.75rem',
                        }}
                      >
                        {t('coaching.markDone')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDirectiveStatus(d.id, 'dismissed')}
                        title={t('coaching.dismiss')}
                        aria-label={t('coaching.dismiss')}
                        style={{
                          background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 6,
                          color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 8px', fontSize: '0.75rem',
                        }}
                      >
                        {t('coaching.dismiss')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </RoleGate>
      </>
      )}

      {activeSub === 'backlog' && (
      /* ── Ranked backlog ── */
      <div>
        <div style={{ ...sectionTitleStyle, marginBottom: 8 }}>{t('backlog.title')}</div>
        {backlog.length === 0 ? (
          <div style={{ ...panelStyle, ...mutedStyle }}>{t('backlog.empty')}</div>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={{ ...thStyle, width: 56 }}>{t('backlog.rank')}</th>
                  <th style={thStyle}>{t('backlog.key')}</th>
                  <th style={thStyle}>{t('backlog.taskTitle')}</th>
                  <th style={thStyle}>{t('backlog.priority')}</th>
                  <th style={{ ...thStyle, width: 160 }}>{t('backlog.businessValue')}</th>
                  <th style={thStyle}>{t('backlog.dueDate')}</th>
                  <th style={thStyle}>{t('backlog.assignee')}</th>
                </tr>
              </thead>
              <tbody>
                {backlog.map((item) => (
                  <BacklogRow
                    key={item.id}
                    item={item}
                    assignee={memberName(item.assignedUserId, item.assignedAgentRef, item.assignedAgentHostId)}
                    unassignedLabel={t('backlog.unassigned')}
                    priorityLabel={t(`priority.${item.priority}`)}
                    bvTooltip={t('backlog.noRationale')}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {activeSub === 'activity' && (
      <>
      {/* ── Manager tasks (the manager's own backlog-management passes) ── */}
      <div>
        <div style={{ ...sectionTitleStyle, marginBottom: 4 }}>{t('runTasks.title')}</div>
        <div style={{ ...mutedStyle, marginBottom: 8 }}>{t('runTasks.caption')}</div>
        {runTasks.length === 0 ? (
          <div style={{ ...panelStyle, ...mutedStyle }}>{t('runTasks.empty')}</div>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('backlog.key')}</th>
                  <th style={{ ...thStyle, width: 130 }}>{t('runTasks.statusCol')}</th>
                  <th style={thStyle}>{t('runTasks.resultCol')}</th>
                  <th style={thStyle}>{t('backlog.assignee')}</th>
                  <th style={{ ...thStyle, width: 120 }}>{t('runTasks.whenCol')}</th>
                </tr>
              </thead>
              <tbody>
                {runTasks.map((rt) => (
                  <RunTaskRow
                    key={rt.id}
                    task={rt}
                    statusLabel={t(`runTasks.status.${runTaskStatusKey(rt.status)}`)}
                    owner={memberName(rt.assignedUserId, rt.assignedAgentRef, rt.assignedAgentHostId)}
                    systemOwnerLabel={t('runTasks.systemOwner')}
                    when={relative(rt.completedAt ?? rt.createdAt)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Activity feed ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={sectionTitleStyle}>{t('activity.title')}</span>
          {running && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent, #2563eb)' }}>
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor', animation: 'bf-pulse 1.2s ease-in-out infinite' }} />
              {t('activity.working')}
            </span>
          )}
        </div>
        {actions.length === 0 ? (
          <div style={{ ...panelStyle, ...mutedStyle }}>{t('activity.empty')}</div>
        ) : (
          <div style={{ ...panelStyle, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {actions.map((a) => (
              <ActivityRow key={a.id} action={a} typeLabel={t(`action.${a.actionType}`)} when={relative(a.createdAt)} />
            ))}
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Notice({ title, body, muted, retryLabel, onRetry }: {
  title: string; body: ReactNode; muted?: boolean; retryLabel?: string; onRetry?: () => void;
}) {
  return (
    <div style={{ ...panelStyle, textAlign: 'center', padding: 40 }}>
      <div style={{ fontWeight: 700, fontSize: '1rem', color: muted ? 'var(--text-muted)' : 'var(--text-primary)' }}>{title}</div>
      {body ? <div style={{ ...mutedStyle, marginTop: 8, maxWidth: 480, marginInline: 'auto' }}>{body}</div> : null}
      {onRetry && retryLabel && (
        <button type="button" style={{ ...primaryBtn, marginTop: 16 }} onClick={onRetry}>{retryLabel}</button>
      )}
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone?: 'warn' }) {
  return (
    <div style={{ ...panelStyle, padding: 14 }}>
      <div style={{ fontSize: '1.6rem', fontWeight: 800, color: tone === 'warn' ? 'var(--warning-fg, #b45309)' : 'var(--text-primary)' }}>
        {value.toLocaleString()}
      </div>
      <div style={{ ...mutedStyle, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function ToggleRow({ label, help, checked, disabled, onChange }: {
  label: string; help: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 0', cursor: disabled ? 'default' : 'pointer' }}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{
          flexShrink: 0, marginTop: 2, width: 40, height: 22, borderRadius: 999, border: 'none', position: 'relative',
          cursor: disabled ? 'default' : 'pointer', transition: 'background 0.2s',
          background: checked ? 'var(--accent, #2563eb)' : 'var(--border-subtle)',
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: checked ? 20 : 2, width: 18, height: 18, borderRadius: '50%',
          background: '#fff', transition: 'left 0.2s',
        }} />
      </button>
      <span>
        <span style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{label}</span>
        <span style={{ display: 'block', ...mutedStyle }}>{help}</span>
      </span>
    </label>
  );
}

function BusinessValueBar({ value, rationale, noRationale }: { value: number | null; rationale: string | null; noRationale: string }) {
  if (value == null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} title={rationale || noRationale}>
      <span style={{ fontWeight: 700, fontSize: '0.82rem', minWidth: 26, color: 'var(--text-primary)' }}>{value}</span>
      <div style={{ position: 'relative', flex: 1, height: 8, minWidth: 40, background: 'var(--border-subtle)', borderRadius: 4 }}>
        <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: 'var(--accent, #2563eb)', borderRadius: 4 }} />
      </div>
    </div>
  );
}

function BacklogRow({ item, assignee, unassignedLabel, priorityLabel, bvTooltip }: {
  item: ManagerBacklogItem; assignee: string; unassignedLabel: string; priorityLabel: string; bvTooltip: string;
}) {
  const unassigned = item.assignedUserId == null && item.assignedAgentRef == null && item.assignedAgentHostId == null;
  return (
    <tr style={trStyle}>
      <td style={{ ...tdStyle, fontWeight: 700, textAlign: 'center' }}>
        {item.managerRank != null ? `#${item.managerRank}` : '—'}
      </td>
      <td style={{ ...tdMutedStyle, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{item.key}</td>
      <td style={tdStyle}>{item.title}</td>
      <td style={tdStyle}>
        <span className={PRIORITY_BADGE[item.priority]} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4 }}>
          {priorityLabel}
        </span>
      </td>
      <td style={tdStyle}>
        <BusinessValueBar value={item.businessValue} rationale={item.businessValueRationale} noRationale={bvTooltip} />
      </td>
      <td style={{ ...tdMutedStyle, whiteSpace: 'nowrap' }}>
        {item.dueDate ? new Date(item.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
      </td>
      <td style={{ ...tdMutedStyle }}>{unassigned ? unassignedLabel : assignee}</td>
    </tr>
  );
}

/** Map a run task's board status onto one of the four run-task status i18n keys. */
function runTaskStatusKey(status: string): 'in_progress' | 'done' | 'blocked' | 'open' {
  if (status === 'in_progress') return 'in_progress';
  if (status === 'done') return 'done';
  if (status === 'blocked') return 'blocked';
  return 'open';
}

/** Status → theme tone for the run-task badge (light + dark safe via CSS vars). */
const RUN_TASK_TONE: Record<'in_progress' | 'done' | 'blocked' | 'open', string> = {
  in_progress: 'var(--accent, #2563eb)',
  done: 'var(--success-fg, #15803d)',
  blocked: 'var(--warning-fg, #b45309)',
  open: 'var(--text-secondary)',
};

function RunTaskRow({ task, statusLabel, owner, systemOwnerLabel, when }: {
  task: ManagerRunTask; statusLabel: string; owner: string; systemOwnerLabel: string; when: string;
}) {
  const key = runTaskStatusKey(task.status);
  const tone = RUN_TASK_TONE[key];
  const unowned = task.assignedUserId == null && task.assignedAgentRef == null && task.assignedAgentHostId == null;
  return (
    <tr style={trStyle}>
      <td style={{ ...tdMutedStyle, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{task.key}</td>
      <td style={tdStyle}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 600,
          color: tone, border: `1px solid ${tone}`, borderRadius: 999, padding: '2px 9px',
        }}>
          <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
          {statusLabel}
        </span>
      </td>
      <td style={tdStyle}>{task.summary || task.title}</td>
      <td style={tdMutedStyle}>{unowned ? systemOwnerLabel : owner}</td>
      <td style={{ ...tdMutedStyle, whiteSpace: 'nowrap' }}>{when}</td>
    </tr>
  );
}

function ActivityRow({ action, typeLabel, when }: { action: ManagerAction; typeLabel: string; when: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span aria-hidden style={{ flexShrink: 0, fontSize: '1rem', lineHeight: '1.3rem' }}>{ACTION_ICON[action.actionType] ?? '•'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {action.taskId != null && (
          <Link
            href={`/projects?tab=tasks&task=${action.taskId}`}
            style={{ display: 'inline-block', marginBottom: 3, color: 'var(--accent, #2563eb)', fontSize: '0.78rem', fontWeight: 700, textDecoration: 'none' }}
          >
            {action.ticketKey ?? `#${action.taskId}`}{action.ticketTitle ? ` · ${action.ticketTitle}` : ''}
          </Link>
        )}
        <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{action.summary}</div>
        {action.detail && <div style={{ ...mutedStyle, marginTop: 2 }}>{action.detail}</div>}
      </div>
      <div style={{ flexShrink: 0, textAlign: 'right' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{typeLabel}</div>
        <div style={{ ...mutedStyle, fontSize: '0.72rem' }}>{when}</div>
      </div>
    </div>
  );
}
