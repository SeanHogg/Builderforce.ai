'use client';

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { tasksApi, kanbanApi, type TicketContext, type TicketObjective } from '@/lib/builderforceApi';

/**
 * The ticket drawer's CONTEXT header — the answer to "why does this matter and
 * how far along is it", above the fold, before any tab.
 *
 * A board card carried more signal than the opened ticket did, and the three
 * questions a manager asks on opening one — is this part of an Epic and how far
 * along is that Epic? how complete is THIS ticket? which objective does it serve
 * and how much of that objective rides on it? — needed a trip to /pmo and the
 * Sign-off tab to answer. One cached read (`GET /api/tasks/:id/context`) answers
 * all three, and the blockers row turns the answer into an action: the roles
 * holding it up are named here, with the button that dispatches them.
 *
 * The %-complete is never a black box: `basis` renders underneath it as the parts
 * it was folded from ("stage 4 of 9", "0 of 10 signed off"), so a number a manager
 * would otherwise distrust is auditable in place.
 */

const card: CSSProperties = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 12,
  background: 'var(--bg-elevated)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minWidth: 0,
};

const label: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.6,
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
};

const linkButton: CSSProperties = {
  border: 'none',
  background: 'none',
  padding: 0,
  font: 'inherit',
  color: 'var(--coral-bright, #f4726e)',
  fontWeight: 600,
  cursor: 'pointer',
  textAlign: 'left',
};

/** Tone a completion bar by how far along it is — red early, amber mid, green done. */
function meterColor(percent: number): string {
  if (percent >= 100) return 'var(--success, #16a34a)';
  if (percent >= 50) return 'var(--coral-bright, #f97316)';
  return 'var(--warning-text, #d97706)';
}

function Meter({ percent, height = 8 }: { percent: number; height?: number }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{ height, borderRadius: 'var(--radius-full)', background: 'var(--bg-deep, #e2e8f0)', overflow: 'hidden', width: '100%' }}
    >
      <div style={{ width: `${Math.min(100, Math.max(0, percent))}%`, height: '100%', background: meterColor(percent), transition: 'width .3s ease' }} />
    </div>
  );
}

function Stat({ children, value, percent }: { children: ReactNode; value: string; percent: number }) {
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={label}>{children}</span>
        <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{value}</span>
      </div>
      <Meter percent={percent} />
    </div>
  );
}

/** One objective this ticket serves, with the ticket's share of its delivery. */
function ObjectiveCard({ objective, onOpen }: { objective: TicketObjective; onOpen: () => void }) {
  const t = useTranslations('ticketContext');
  const kr = objective.keyResults;
  return (
    <div style={{ ...card, gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: '1 1 200px' }}>
          <div style={label}>
            {t(`via.${objective.via}`)}
            {objective.viaLabel ? ` · ${objective.viaLabel}` : ''}
            {objective.period ? ` · ${objective.period}` : ''}
          </div>
          <button type="button" onClick={onOpen} style={{ ...linkButton, fontSize: 14, marginTop: 2 }}>
            {objective.title}
          </button>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{objective.percent}%</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t('objectiveAttained')}</div>
        </div>
      </div>
      <Meter percent={objective.percent} height={6} />
      {/* Why this ticket matters to the goal: its share of the linked delivery. */}
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        {objective.sharePercent > 0
          ? t.rich('objectiveShare', {
              share: objective.sharePercent,
              done: objective.linkedTaskDone,
              total: objective.linkedTaskCount,
              b: (chunks) => <strong style={{ color: 'var(--text-primary)' }}>{chunks}</strong>,
            })
          : t('objectiveInherited')}
      </div>
      {kr.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {kr.map((k) => (
            <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 140px', minWidth: 0, color: 'var(--text-secondary)' }}>{k.title}</span>
              <span style={{ flex: '0 0 70px', maxWidth: 70 }}><Meter percent={k.percent} height={5} /></span>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', minWidth: 34, textAlign: 'right' }}>
                {k.percent}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface TicketContextStripProps {
  taskId: number;
  /** Open the parent Epic in the drawer (the board owns ticket navigation). */
  onOpenEpic?: (epicId: number) => void;
  /** Jump to a drawer tab — how the strip turns a blocker into one click. */
  onOpenTab?: (tab: 'agent' | 'accountability' | 'prd') => void;
  /** Re-load the board after an action that can move the ticket. */
  onChanged?: () => void;
}

export function TicketContextStrip({ taskId, onOpenEpic, onOpenTab, onChanged }: TicketContextStripProps) {
  const t = useTranslations('ticketContext');
  const [ctx, setCtx] = useState<TicketContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coordinating, setCoordinating] = useState(false);

  const load = useCallback(() => {
    let alive = true;
    tasksApi.context(taskId)
      .then((c) => { if (alive) { setCtx(c); setError(null); } })
      .catch((e) => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, [taskId]);

  useEffect(() => load(), [load]);

  // Dispatch the reviewers/producers the ticket is actually waiting on. This is
  // the SAME coordinate call the Agent tab exposes — surfaced next to the roles it
  // unblocks so the outstanding sign-off is actionable where it is reported.
  const coordinate = useCallback(() => {
    setCoordinating(true);
    kanbanApi.coordinate(taskId)
      .then(() => { load(); onChanged?.(); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setCoordinating(false));
  }, [taskId, load, onChanged]);

  if (error) {
    return <div style={{ fontSize: 12, color: 'var(--danger-text, #991b1b)', marginBottom: 12 }}>{error}</div>;
  }
  // Nothing to show until it loads — the drawer's own content is already useful,
  // so a skeleton here would only push it down.
  if (!ctx) return null;

  const { completion, signoff, epic, children, objectives } = ctx;
  const rollup = children ?? epic;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
      {/* Headline meters — this ticket, its Epic, its sign-offs. */}
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Stat value={`${completion.percent}%`} percent={completion.percent}>
          {t('thisTicket')}
        </Stat>
        {rollup && (
          <Stat value={`${rollup.percent}%`} percent={rollup.percent}>
            {children ? t('thisEpic') : t('parentEpic')}
          </Stat>
        )}
        {signoff.required > 0 && (
          <Stat value={`${signoff.completed}/${signoff.required}`} percent={signoff.percent}>
            {t('signoffs')}
          </Stat>
        )}
      </div>

      {/* What the headline number is made of — so it is auditable, not asserted. */}
      {completion.basis.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)' }}>
          {completion.basis.map((b) => (
            <span key={b.kind}>
              {b.kind === 'lane'
                ? t('basisLane', { index: b.done, total: b.total })
                : b.kind === 'signoff'
                  ? t('basisSignoff', { done: b.done, total: b.total })
                  : t('basisChildren', { done: b.done, total: b.total })}
              {b.weight < 1 ? ` · ${t('basisWeight', { weight: Math.round(b.weight * 100) })}` : ''}
            </span>
          ))}
        </div>
      )}

      {/* The Epic this ticket rolls up to — named and clickable, not just implied. */}
      {epic && (
        <div style={{ ...card, flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={label}>{t('partOfEpic')}</span>
          <button
            type="button"
            onClick={() => onOpenEpic?.(epic.id)}
            style={{ ...linkButton, fontSize: 13, flex: '1 1 180px', minWidth: 0 }}
          >
            {epic.title}
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            {t('epicChildren', { done: epic.done, total: epic.total })}
          </span>
        </div>
      )}

      {/* Blockers → action. The roles holding the ticket up, plus the dispatcher. */}
      {(signoff.outstandingRoles.length > 0 || signoff.gaps > 0) && (
        <div
          style={{
            ...card,
            border: '1px solid var(--warning-border, #fed7aa)',
            background: 'var(--warning-bg, #fffbeb)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ ...label, color: 'var(--warning-text, #854d0e)' }}>{t('waitingOn')}</span>
            <span style={{ fontSize: 13, color: 'var(--warning-text, #854d0e)', flex: '1 1 180px', minWidth: 0 }}>
              {signoff.outstandingRoles.length > 0
                ? signoff.outstandingRoles.join(' · ')
                : t('gapsOnly', { count: signoff.gaps })}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={coordinate}
              disabled={coordinating}
              style={{
                padding: '6px 12px', borderRadius: 'var(--radius-md)', border: 'none', fontSize: 12, fontWeight: 700,
                background: 'var(--coral-bright, #f97316)', color: 'var(--text-on-accent)',
                cursor: coordinating ? 'default' : 'pointer', opacity: coordinating ? 0.65 : 1,
              }}
            >
              {coordinating ? t('dispatching') : t('dispatchReviewers')}
            </button>
            <button
              type="button"
              onClick={() => onOpenTab?.('accountability')}
              style={{
                padding: '6px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
                background: 'var(--bg-base)', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {t('reviewSignoffs')}
            </button>
          </div>
        </div>
      )}

      {/* The goal(s) this ticket serves. Absent = an honest prompt, not silence. */}
      {objectives.length > 0 ? (
        objectives.map((o) => (
          <ObjectiveCard key={o.id} objective={o} onOpen={() => { window.location.href = `/pmo?objective=${o.id}`; }} />
        ))
      ) : (
        <div style={{ ...card, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={label}>{t('objective')}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: '1 1 200px' }}>{t('noObjective')}</span>
        </div>
      )}
    </div>
  );
}
