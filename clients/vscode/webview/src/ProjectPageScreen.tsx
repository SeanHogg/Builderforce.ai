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

/**
 * The list-shaped project pages (Backlog, PRDs) — the thin transport wrapper around
 * the shared <ProjectListView>, exactly as <App>'s Chat wraps <BrainTimeline> and
 * Project360Screen wraps <Project360View>. One screen serves every list view: it
 * fetches the view's endpoint directly over HTTPS with the host-minted tenant token
 * (re-minting once on a 401), maps the response into the generic list model, and
 * forwards row actions to the privileged host. Adding a view = adding a `PAGES`
 * entry (endpoint + mapper); nothing else here changes.
 */

type PageView = 'backlog' | 'prd';

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

interface PageConfig {
  endpoint: (projectId: number) => string;
  titleKey: string;
  emptyKey: string;
  emptyHintKey: string;
  map: (json: unknown, L: (k: string, fb: string) => string) => ProjectListModel;
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

const PAGES: Record<PageView, PageConfig> = {
  backlog: {
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
};

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
    if (projectId == null) {
      setError('No project is selected.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const call = (token: string | null) =>
      fetch(`${init.baseUrl}${cfg.endpoint(projectId)}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
    try {
      let res = await call(getToken());
      if (res.status === 401) {
        await refreshToken();
        res = await call(getToken());
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(cfg.map(await res.json(), L));
    } catch (e) {
      setError((e as Error).message || 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [projectId, init.baseUrl, cfg, L]);

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
