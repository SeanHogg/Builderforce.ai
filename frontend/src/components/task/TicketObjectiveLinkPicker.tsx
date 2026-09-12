'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { pmoApi, type Objective } from '@/lib/builderforceApi';
import { usePermission } from '@/lib/rbac';
import { RoleGate } from '@/components/RoleGate';
import { Select } from '@/components/Select';
import { faultMessage } from '@/lib/apiClient';
import { contextCard, contextLabel, contextLinkButton } from './ticketContextStyles';

/**
 * LINK THIS TICKET TO AN OBJECTIVE, from the ticket.
 *
 * The context strip reported "not linked to an objective" and pointed at the Planning
 * board, because an objective link was writable ONLY through
 * `POST /api/pmo/objectives/:id/links` — which the Planning board was the only surface
 * to call. So the gap was noticed here and could only be closed somewhere else: leave
 * the board, find the objective, link from the other end, come back. This card is the
 * strip's empty state AND the fix for it.
 *
 * Self-contained: it loads the objective list, decides its own permission, posts the
 * link, and hands the strip one `onLinked` callback to re-read its context.
 *
 * PERMISSION — `pmo.objectives.link` maps to MANAGER, the same floor the route enforces
 * (`requireRole(MANAGER)`); the server stays the authority. Everyone else sees the
 * control DISABLED under a `<RoleGate>` (never hidden), so a viewer learns linking
 * exists and who can do it — and a signed-out guest gets the account prompt instead
 * of a role hint that no promotion could satisfy.
 *
 * SCOPE — one read of the workspace's objectives, grouped so the ticket's OWN project's
 * objectives come first. Deliberately not `?project=`: that filter returns only
 * objectives scoped directly to the project, and a ticket may legitimately serve a
 * workspace, portfolio or initiative OKR.
 *
 * CACHE — no client-side memo. `GET /api/pmo/objectives` is already served read-through
 * from the server cache (`cacheNs: 'pmo-objectives'`, invalidated on every objective
 * write), and a link write does not change that list, so there is nothing for the link
 * to invalidate. A session memo would only add staleness: an objective created on the
 * Planning board would be missing here until reload. The list is fetched only when
 * this empty state renders — a ticket that already serves an objective never mounts it.
 */

/** The capability the link route's `requireRole(MANAGER)` corresponds to. */
const LINK_CAPABILITY = 'pmo.objectives.link';

export interface GroupedObjectives {
  /** Objectives scoped directly to the ticket's project, by title. */
  project: Objective[];
  /** Everything else the ticket could serve (workspace / portfolio / initiative / other projects), by title. */
  other: Objective[];
}

/** Split the objective list into the ticket's project first, the rest after — each sorted by title. */
export function groupObjectivesForTicket(objectives: readonly Objective[], projectId: number | null | undefined): GroupedObjectives {
  const byTitle = (a: Objective, b: Objective) => a.title.localeCompare(b.title);
  const inProject = (o: Objective) => projectId != null && o.projectId === projectId;
  return {
    project: objectives.filter(inProject).sort(byTitle),
    other: objectives.filter((o) => !inProject(o)).sort(byTitle),
  };
}

type ListState =
  | { status: 'loading' }
  | { status: 'ready'; rows: Objective[] }
  // A failed read is NOT an empty workspace: saying "no objectives exist yet" when the
  // request failed would send a manager off to create a duplicate.
  // `detail` is null when the fault was a guest wall the transport already surfaced.
  | { status: 'failed'; detail: string | null };

export interface TicketObjectiveLinkPickerProps {
  taskId: number;
  /** The ticket's project — its objectives are offered first. */
  projectId: number | null;
  /** Called after the link is written, so the owner re-reads what the ticket serves. */
  onLinked: () => void;
}

export function TicketObjectiveLinkPicker({ taskId, projectId, onLinked }: TicketObjectiveLinkPickerProps) {
  const t = useTranslations('ticketContext');
  const { allowed } = usePermission(LINK_CAPABILITY);
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    pmoApi.objectives.list()
      .then((rows) => { if (alive) setList({ status: 'ready', rows }); })
      .catch((e) => { if (alive) setList({ status: 'failed', detail: faultMessage(e) }); });
    return () => { alive = false; };
  }, [attempt]);

  const retry = useCallback(() => {
    setList({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  const groups = useMemo(
    () => groupObjectivesForTicket(list.status === 'ready' ? list.rows : [], projectId),
    [list, projectId],
  );

  const link = useCallback(() => {
    if (!choice || !allowed) return;
    setBusy(true);
    setError(null);
    pmoApi.objectives.addLink(choice, { linkKind: 'task', taskId })
      .then(() => { setChoice(''); onLinked(); })
      .catch((e) => setError(faultMessage(e)))
      .finally(() => setBusy(false));
  }, [choice, allowed, taskId, onLinked]);

  const empty = list.status === 'ready' && list.rows.length === 0;
  const selectDisabled = !allowed || busy || list.status !== 'ready' || empty;
  const linkDisabled = !allowed || busy || !choice;

  const renderOption = (o: Objective) => (
    <option key={o.id} value={o.id}>{o.period ? `${o.title} · ${o.period}` : o.title}</option>
  );
  // Group headers only when there is something to tell apart. An ARRAY, not a fragment:
  // `Select` walks its direct children for `<option>`/`<optgroup>`, and a fragment is neither.
  const optionRows = groups.project.length > 0 && groups.other.length > 0
    ? [
        <optgroup key="project" label={t('projectObjectives')}>{groups.project.map(renderOption)}</optgroup>,
        <optgroup key="other" label={t('otherObjectives')}>{groups.other.map(renderOption)}</optgroup>,
      ]
    : [...groups.project, ...groups.other].map(renderOption);

  return (
    <div style={{ ...contextCard, gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={contextLabel}>{t('objective')}</span>
        <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', flex: '1 1 200px', minWidth: 0 }}>{t('noObjective')}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          disabled={selectDisabled}
          aria-label={t('linkObjectiveLabel')}
          style={{ flex: '1 1 200px', minWidth: 0, fontSize: 'var(--font-size-small)' }}
        >
          <option value="">{list.status === 'loading' ? t('loadingObjectives') : t('chooseObjective')}</option>
          {optionRows}
        </Select>
        <RoleGate capability={LINK_CAPABILITY}>
          <button
            type="button"
            onClick={link}
            disabled={linkDisabled}
            style={{
              padding: '6px 12px', borderRadius: 'var(--radius-md)', border: 'none', fontSize: 'var(--font-size-small)', fontWeight: 700,
              background: 'var(--coral-bright)', color: 'var(--text-on-accent)',
              cursor: linkDisabled ? 'default' : 'pointer',
              opacity: linkDisabled ? 0.6 : 1,
            }}
          >
            {busy ? t('linking') : t('linkObjective')}
          </button>
        </RoleGate>
      </div>
      {empty && <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{t('noObjectivesYet')}</span>}
      {list.status === 'failed' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span role="alert" title={list.detail ?? undefined} style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--danger-text)' }}>{t('loadObjectivesFailed')}</span>
          <button type="button" onClick={retry} style={{ ...contextLinkButton, fontSize: 'var(--font-size-eyebrow)' }}>{t('retryLoadObjectives')}</button>
        </div>
      )}
      {error && <span role="alert" style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--danger-text)' }}>{error}</span>}
    </div>
  );
}
