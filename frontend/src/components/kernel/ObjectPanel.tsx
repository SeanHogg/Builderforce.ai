'use client';

/**
 * ONE detail surface for anything addressable (PRD 20 §7.1).
 *
 * "`object` → One detail route. One breadcrumb. One *open in canvas*." This is
 * that route's body: a breadcrumb from `/trail`, and the five kernel relations
 * as tabs — activity, comments, members, shares, revisions. A task, an artifact,
 * a deal and a candidate all render through it, because after the consolidation
 * they are all rows in `objects` with the same five relations hanging off them.
 *
 * A SLIDE-OUT, NOT A MODAL. The platform's convention is that modals are for
 * destructive approvals only; everything else is a panel you can leave open
 * beside the thing it describes. Revoking a share link is the one action here
 * that is destructive, and it lives inside the sheet with its own confirmation
 * rather than promoting the whole panel to a modal.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  getObject,
  getObjectMembers,
  getObjectRevisions,
  getObjectTrail,
  type Membership,
  type ObjectRef,
  type Revision,
} from '@/lib/kernel/kernelApi';
import { ObjectTimeline } from './ObjectTimeline';
import { ObjectComments } from './ObjectComments';
import { ObjectShareSheet } from './ObjectShareSheet';
import { useFormat } from "@/i18n/useFormat";

const TABS = ['activity', 'comments', 'members', 'shares', 'revisions'] as const;
type Tab = (typeof TABS)[number];

/** Members and revisions are two short lists with no interaction beyond reading
 *  them, so they live here rather than earning a component each — the same rule
 *  §0 applies to tables, one layer up. */
function MemberList({ objectId, emptyLabel }: { objectId: string; emptyLabel: string }) {
  const [rows, setRows] = useState<Membership[] | null>(null);
  useEffect(() => {
    void getObjectMembers(objectId).then(setRows).catch(() => setRows([]));
  }, [objectId]);
  if (rows === null) return null;
  if (rows.length === 0) return <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>{emptyLabel}</p>;
  return (
    <ul className="flex flex-col gap-0 m-0 p-0 list-none">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-2 py-2 flex-wrap" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{r.memberRef}</span>
          <span
            className="text-[0.65rem] uppercase tracking-wider rounded px-1.5 py-0.5"
            style={{ background: 'var(--surface-2, rgba(255,255,255,0.08))', color: 'var(--text-secondary)' }}
          >
            {r.role}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RevisionList({ objectId, emptyLabel, locale }: { objectId: string; emptyLabel: string; locale: string }) {
    const fmt = useFormat();
  const [rows, setRows] = useState<Revision[] | null>(null);
  useEffect(() => {
    void getObjectRevisions(objectId).then(setRows).catch(() => setRows([]));
  }, [objectId]);
  if (rows === null) return null;
  if (rows.length === 0) return <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>{emptyLabel}</p>;
  return (
    <ul className="flex flex-col gap-0 m-0 p-0 list-none">
      {rows.map((r) => (
        <li key={r.id} className="flex items-baseline gap-2 py-2 flex-wrap" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <span className="text-sm font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>v{r.version}</span>
          <span className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>{r.label ?? r.summary ?? ''}</span>
          <span className="flex-1" />
          <time dateTime={r.createdAt} className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {fmt.date(r.createdAt)}
          </time>
        </li>
      ))}
    </ul>
  );
}

export function ObjectPanel({
  objectId,
  onClose,
  locale = 'en',
}: {
  objectId?: string;
  onClose?: () => void;
  locale?: string;
}) {
  const t = useTranslations('kernel.panel');
  const [object, setObject] = useState<ObjectRef | null>(null);
  const [trail, setTrail] = useState<ObjectRef[]>([]);
  const [tab, setTab] = useState<Tab>('activity');

  const load = useCallback(async () => {
    if (!objectId) return;
    const [o, tr] = await Promise.all([
      getObject(objectId).catch(() => null),
      getObjectTrail(objectId).catch(() => [] as ObjectRef[]),
    ]);
    setObject(o);
    setTrail(tr);
  }, [objectId]);

  useEffect(() => { void load(); }, [load]);

  if (!objectId) return null;

  return (
    <section
      className="flex flex-col min-w-0 h-full rounded-lg overflow-hidden"
      style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)' }}
      aria-label={t('title')}
    >
      <header
        className="flex items-start gap-3 px-4 py-3"
        style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-2, rgba(255,255,255,0.04))' }}
      >
        <div className="min-w-0 flex-1">
          {/* ONE breadcrumb — a recursive walk over `objects.parent_id`, not a
              per-feature ancestry helper. */}
          {trail.length > 1 ? (
            <nav aria-label={t('breadcrumb')} className="flex flex-wrap items-center gap-1 mb-1">
              {trail.slice(0, -1).map((node) => (
                <span key={node.id} className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                  {node.title ?? node.kind} <span aria-hidden>/</span>
                </span>
              ))}
            </nav>
          ) : null}
          <h2 className="m-0 text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
            {object?.title ?? t('untitled')}
          </h2>
          {object ? (
            <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
              {object.kind} · {object.domain}
            </p>
          ) : null}
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="shrink-0 rounded-md w-7 h-7 text-sm"
            style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
          >
            ×
          </button>
        ) : null}
      </header>

      <nav
        className="flex gap-1 px-3 pt-2 overflow-x-auto"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
        aria-label={t('sections')}
      >
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key}
            className="whitespace-nowrap text-sm px-2.5 py-1.5 rounded-t-md"
            style={{
              color: tab === key ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: `2px solid ${tab === key ? 'var(--accent)' : 'transparent'}`,
              background: 'transparent',
            }}
          >
            {t(`tab.${key}`)}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
        {tab === 'activity' ? <ObjectTimeline objectId={objectId} locale={locale} /> : null}
        {tab === 'comments' ? <ObjectComments objectId={objectId} locale={locale} /> : null}
        {tab === 'members' ? <MemberList objectId={objectId} emptyLabel={t('noMembers')} /> : null}
        {tab === 'shares' ? <ObjectShareSheet objectId={objectId} locale={locale} /> : null}
        {tab === 'revisions' ? <RevisionList objectId={objectId} emptyLabel={t('noRevisions')} locale={locale} /> : null}
      </div>
    </section>
  );
}
