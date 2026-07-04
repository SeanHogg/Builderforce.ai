import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ProjectListView,
  type ProjectListAction,
  type ProjectListGroup,
  type ProjectListModel,
  type ProjectListLabels,
  type ProjectListTone,
} from '@seanhogg/builderforce-brain-ui';
import { getToken, onIntent, post, refreshToken, type InitData, type LabelBundle } from './vscodeBridge';
import { authedFetch } from './authedFetch';

/**
 * The list-shaped project pages (Backlog, PRDs) — the thin transport wrapper around
 * the shared <ProjectListView>, exactly as <App>'s Chat wraps <BrainTimeline> and
 * Project360Screen wraps <Project360View>. One screen serves every list view: it
 * fetches the view's endpoint directly over HTTPS with the host-minted tenant token
 * (re-minting once on a 401), maps the response into the generic list model, and
 * forwards row actions to the privileged host. Adding a view = adding a `PAGES`
 * entry (endpoint + mapper); nothing else here changes.
 */

type PageView = 'backlog' | 'prd' | 'roadmap' | 'retros' | 'poker';

interface RawTask {
  id: number;
  key?: string;
  title: string;
  status?: string;
  priority?: string;
  assignedUserId?: string | null;
}
interface RawSpec {
  id: string;
  goal?: string;
  status?: string;
  kind?: string;
}
interface RawRoadmap {
  id: string;
  title?: string;
  horizon?: string;
  status?: string;
  theme?: string;
  priority?: string;
  targetDate?: string | null;
}
interface RawSession {
  id: string;
  name?: string;
  status?: string;
  template?: string;
  votingSystem?: string;
  createdAt?: string | null;
}

interface PageConfig {
  /** Builds the REST path. `projectId` is null for workspace-scoped views. */
  endpoint: (projectId: number | null) => string;
  /** false = workspace-scoped (Retros/Poker) — no project needed to load. */
  projectScoped: boolean;
  titleKey: string;
  emptyKey: string;
  emptyHintKey: string;
  map: (json: unknown, L: (k: string, fb: string) => string) => ProjectListModel;
}

/** Short localized date for a row subtitle; '' when absent/unparseable. */
function fmtDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const STATUS_TONE: Record<string, ProjectListTone> = {
  active: 'accent',
  in_progress: 'accent',
  shipped: 'ok',
  done: 'ok',
  complete: 'ok',
  closed: 'muted',
  blocked: 'danger',
};

function statusBadge(status: string | undefined, L: (k: string, fb: string) => string) {
  const s = (status ?? '').toLowerCase();
  if (!s) return undefined;
  return { label: L(`st.${s}`, s.charAt(0).toUpperCase() + s.slice(1).replace(/[_-]+/g, ' ')), tone: STATUS_TONE[s] ?? 'default' };
}

/** Order + display of Backlog status groups. Unknown statuses fall to their own group. */
const TASK_GROUPS: { match: string[]; key: string; labelKey: string; label: string; tone: ProjectListTone }[] = [
  { match: ['in_progress', 'in-progress', 'running'], key: 'in_progress', labelKey: 'st.in_progress', label: 'In progress', tone: 'accent' },
  { match: ['in_review', 'review'], key: 'in_review', labelKey: 'st.in_review', label: 'In review', tone: 'accent' },
  { match: ['todo', 'to_do', 'open', 'backlog', ''], key: 'todo', labelKey: 'st.todo', label: 'To do', tone: 'default' },
  { match: ['blocked'], key: 'blocked', labelKey: 'st.blocked', label: 'Blocked', tone: 'danger' },
  { match: ['done', 'complete', 'completed'], key: 'done', labelKey: 'st.done', label: 'Done', tone: 'ok' },
];

const PRIORITY_TONE: Record<string, ProjectListTone> = { urgent: 'danger', high: 'warn', medium: 'default', low: 'muted' };

function priorityBadge(priority: string | undefined, L: (k: string, fb: string) => string) {
  const p = (priority ?? '').toLowerCase();
  if (!p || p === 'none') return undefined;
  const label = L(`pr.${p}`, p.charAt(0).toUpperCase() + p.slice(1));
  return { label, tone: PRIORITY_TONE[p] ?? 'default' };
}

const SPEC_GROUPS: { match: string[]; key: string; labelKey: string; label: string; tone: ProjectListTone }[] = [
  { match: ['in_progress', 'in-progress'], key: 'in_progress', labelKey: 'st.in_progress', label: 'In progress', tone: 'accent' },
  { match: ['ready'], key: 'ready', labelKey: 'st.ready', label: 'Ready', tone: 'accent' },
  { match: ['draft', ''], key: 'draft', labelKey: 'st.draft', label: 'Draft', tone: 'default' },
  { match: ['complete', 'completed', 'done'], key: 'complete', labelKey: 'st.complete', label: 'Complete', tone: 'ok' },
];

/** Bucket items into ordered, configured groups; anything unmatched → an "Other" group. */
function groupBy<T>(
  items: T[],
  statusOf: (t: T) => string,
  toRow: (t: T) => ProjectListGroup['items'][number],
  groups: { match: string[]; key: string; labelKey: string; label: string; tone: ProjectListTone }[],
  L: (k: string, fb: string) => string,
): ProjectListGroup[] {
  const buckets = new Map<string, ProjectListGroup['items']>();
  const other: ProjectListGroup['items'] = [];
  for (const it of items) {
    const s = (statusOf(it) ?? '').toLowerCase();
    const g = groups.find((grp) => grp.match.includes(s));
    if (g) {
      const arr = buckets.get(g.key) ?? [];
      arr.push(toRow(it));
      buckets.set(g.key, arr);
    } else {
      other.push(toRow(it));
    }
  }
  const out: ProjectListGroup[] = groups
    .filter((g) => (buckets.get(g.key)?.length ?? 0) > 0)
    .map((g) => ({ key: g.key, label: L(g.labelKey, g.label), tone: g.tone, items: buckets.get(g.key)! }));
  if (other.length) out.push({ key: 'other', label: L('st.other', 'Other'), tone: 'muted', items: other });
  return out;
}

/** Roadmap horizon groups (Now / Next / Later); unknown horizons fall to "Other". */
const HORIZON_GROUPS: { match: string[]; key: string; labelKey: string; label: string; tone: ProjectListTone }[] = [
  { match: ['now', 'current'], key: 'now', labelKey: 'hz.now', label: 'Now', tone: 'accent' },
  { match: ['next'], key: 'next', labelKey: 'hz.next', label: 'Next', tone: 'default' },
  { match: ['later', 'future'], key: 'later', labelKey: 'hz.later', label: 'Later', tone: 'muted' },
];

/** Session groups (Active / Closed) for Retrospectives + Planning Poker. */
const SESSION_GROUPS: { match: string[]; key: string; labelKey: string; label: string; tone: ProjectListTone }[] = [
  { match: ['active', ''], key: 'active', labelKey: 'st.active', label: 'Active', tone: 'accent' },
  { match: ['closed', 'done', 'complete', 'completed'], key: 'closed', labelKey: 'st.closed', label: 'Closed', tone: 'muted' },
];

const PAGES: Record<PageView, PageConfig> = {
  backlog: {
    projectScoped: true,
    endpoint: (p) => `/api/tasks?project_id=${p}`,
    titleKey: 'backlog.title',
    emptyKey: 'backlog.empty',
    emptyHintKey: 'backlog.emptyHint',
    map: (json, L) => {
      const tasks = ((json as { tasks?: RawTask[] })?.tasks ?? []).filter((t) => t && typeof t.id === 'number');
      const groups = groupBy(
        tasks,
        (t) => t.status ?? '',
        (t) => {
          const badge = priorityBadge(t.priority, L);
          return {
            id: t.id,
            key: t.key,
            title: t.title || `#${t.id}`,
            badges: badge ? [badge] : undefined,
            action: {
              kind: 'open-task' as const,
              label: L('act.openTask', 'Open a working session for this task'),
              task: { id: t.id, key: t.key, title: t.title || `#${t.id}` },
            },
          };
        },
        TASK_GROUPS,
        L,
      );
      return { groups, total: tasks.length };
    },
  },
  prd: {
    projectScoped: true,
    endpoint: (p) => `/api/specs?projectId=${p}`,
    titleKey: 'prd.title',
    emptyKey: 'prd.empty',
    emptyHintKey: 'prd.emptyHint',
    map: (json, L) => {
      const specs = ((json as { specs?: RawSpec[] })?.specs ?? []).filter((s) => s && s.id != null);
      const groups = groupBy(
        specs,
        (s) => s.status ?? '',
        (s) => {
          const title = s.goal?.trim() || '(untitled spec)';
          return {
            id: s.id,
            key: s.kind,
            title,
            action: {
              kind: 'brain' as const,
              label: L('act.workPrd', 'Work on this spec with the Brain'),
              text: L('prd.seed', 'Let\'s work on the spec "{title}". Summarise it, then help me move it forward.').replace('{title}', title),
            },
          };
        },
        SPEC_GROUPS,
        L,
      );
      return { groups, total: specs.length };
    },
  },
  roadmap: {
    projectScoped: true,
    endpoint: (p) => `/api/product/roadmap?project=${p}`,
    titleKey: 'roadmap.title',
    emptyKey: 'roadmap.empty',
    emptyHintKey: 'roadmap.emptyHint',
    map: (json, L) => {
      const items = (Array.isArray(json) ? (json as RawRoadmap[]) : []).filter((r) => r && r.id != null);
      const groups = groupBy(
        items,
        (r) => r.horizon ?? '',
        (r) => {
          const title = r.title?.trim() || '(untitled)';
          const date = fmtDate(r.targetDate);
          const badges = [statusBadge(r.status, L), priorityBadge(r.priority, L)].filter(Boolean) as ProjectListModel['groups'][number]['items'][number]['badges'];
          return {
            id: r.id,
            title,
            subtitle: [r.theme, date].filter(Boolean).join(' · ') || undefined,
            badges,
            action: {
              kind: 'brain' as const,
              label: L('act.workRoadmap', 'Plan this roadmap item with the Brain'),
              text: L('roadmap.seed', 'Let\'s work on the roadmap item "{title}". Summarise it and help me plan the work to deliver it.').replace('{title}', title),
            },
          };
        },
        HORIZON_GROUPS,
        L,
      );
      return { groups, total: items.length };
    },
  },
  retros: {
    projectScoped: false,
    endpoint: () => `/api/agile/retros`,
    titleKey: 'retros.title',
    emptyKey: 'retros.empty',
    emptyHintKey: 'retros.emptyHint',
    map: (json, L) => mapSessions(json, L, { template: true, seedKey: 'retros.seed', actKey: 'act.workRetro', actFallback: 'Review this retrospective with the Brain' }),
  },
  poker: {
    projectScoped: false,
    endpoint: () => `/api/agile/poker/sessions`,
    titleKey: 'poker.title',
    emptyKey: 'poker.empty',
    emptyHintKey: 'poker.emptyHint',
    map: (json, L) => mapSessions(json, L, { seedKey: 'poker.seed', actKey: 'act.workPoker', actFallback: 'Review this session with the Brain' }),
  },
};

/** Shared mapper for the two workspace-scoped session lists (Retros + Poker) — same
 *  shape ({id,name,status,createdAt,…}), grouped by status, one Brain action per row. */
function mapSessions(
  json: unknown,
  L: (k: string, fb: string) => string,
  o: { template?: boolean; seedKey: string; actKey: string; actFallback: string },
): ProjectListModel {
  const sessions = (Array.isArray(json) ? (json as RawSession[]) : []).filter((s) => s && s.id != null);
  const groups = groupBy(
    sessions,
    (s) => s.status ?? '',
    (s) => {
      const title = s.name?.trim() || '(untitled)';
      const meta = o.template ? s.template : s.votingSystem;
      const date = fmtDate(s.createdAt);
      return {
        id: s.id,
        title,
        subtitle: [meta, date].filter(Boolean).join(' · ') || undefined,
        action: {
          kind: 'brain' as const,
          label: L(o.actKey, o.actFallback),
          text: L(o.seedKey, '{title}').replace('{title}', title),
        },
      };
    },
    SESSION_GROUPS,
    L,
  );
  return { groups, total: sessions.length };
}

export function ProjectPageScreen({ init, view }: { init: InitData; view: PageView }) {
  const projectId = init.project?.id;
  const cfg = PAGES[view];
  const L = useCallback(
    (key: string, fallback: string) => (init.labels as LabelBundle)[key] ?? fallback,
    [init.labels],
  );
  const [data, setData] = useState<ProjectListModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Shared bearer-fetch: attaches the host-minted token and, on a 401, re-mints via
  // `refreshToken` and retries once (the promise-returning refresher opts into a retry).
  const api = useMemo(() => authedFetch(init.baseUrl, getToken, refreshToken), [init.baseUrl]);

  const listLabels = useMemo<Partial<ProjectListLabels>>(
    () => ({
      refresh: L('list.refresh', 'Refresh'),
      connecting: L('list.connecting', 'Loading…'),
      loadError: L('list.loadError', "Couldn't load this page"),
      empty: L(cfg.emptyKey, 'Nothing here yet'),
      emptyHint: L(cfg.emptyHintKey, ''),
      items: L('list.items', 'items'),
    }),
    [L, cfg.emptyKey, cfg.emptyHintKey],
  );

  const load = useCallback(async () => {
    if (cfg.projectScoped && projectId == null) {
      setError('No project is selected.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(cfg.map(await api<unknown>(cfg.endpoint(projectId ?? null)), L));
    } catch (e) {
      setError((e as Error).message || 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [projectId, api, cfg, L]);

  useEffect(() => { void load(); }, [load]);
  // Host re-pushes `revalidate` when the panel regains focus.
  useEffect(() => onIntent((intent) => { if (intent.kind === 'revalidate') void load(); }), [load]);

  const onAction = useCallback((action: ProjectListAction) => {
    post('page.action', { action: action as unknown as Record<string, unknown> });
  }, []);

  return (
    <ProjectListView
      title={L(cfg.titleKey, view)}
      data={data}
      loading={loading}
      error={error}
      labels={listLabels}
      onAction={onAction}
      onRefresh={() => void load()}
    />
  );
}
