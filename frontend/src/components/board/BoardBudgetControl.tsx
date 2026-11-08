'use client';

/**
 * The board's "Earned budget" control: a header button that opens a slide-out with
 * what the board has earned (points from Done tickets), what its runs have cost, the
 * recent statement and the milestones it reached. Self-contained - it owns its fetch,
 * so the board itself carries none of it - and loads only when opened.
 */
import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { SectionEmpty, SectionError, SectionLoading } from '@/components/ui/SectionState';
import { StatTile } from '@/components/ui/StatTile';
import { boardBudgetApi, type BoardBudget } from '@/lib/boardBudgetApi';
import { formatCents } from '@/lib/canvasMoney';

const eyebrow: React.CSSProperties = { fontSize: 'var(--font-size-eyebrow)', color: 'var(--muted)', fontWeight: 600 };
const list: React.CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 };
const row: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap',
  padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 'var(--font-size-small)', color: 'var(--text-primary)',
};

export function BoardBudgetControl({ boardId, buttonStyle }: { boardId: string; buttonStyle: React.CSSProperties }) {
  const t = useTranslations('boardBudget');
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [budget, setBudget] = useState<BoardBudget | null>(null);
  const [error, setError] = useState<unknown>(null);

  // A different board must never show the previous board's numbers while it loads.
  useEffect(() => { setBudget(null); setError(null); }, [boardId]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setError(null);
    boardBudgetApi.get(boardId)
      .then((b) => { if (live) setBudget(b); })
      .catch((e) => { if (live) setError(e); });
    return () => { live = false; };
  }, [open, boardId]);

  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={buttonStyle}
        aria-label={t('openAria')}
        title={t('openTitle')}
      >
        <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
          <rect x="2" y="6" width="20" height="14" rx="2" />
          <path d="M2 10h20" />
          <circle cx="17" cy="15" r="1.2" />
        </svg>
      </button>

      <SlideOutPanel open={open} onClose={() => setOpen(false)} title={t('title')} width="sheet">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          {error != null ? <SectionError error={error} /> : !budget ? <SectionLoading label={t('loading')} /> : (
            <>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 'var(--font-size-small)' }}>{t('intro')}</p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <StatTile label={t('earned')} value={t('points', { count: budget.balance })} />
                <StatTile label={t('spent')} value={formatCents(budget.spentUsdCents)} />
              </div>

              <section aria-label={t('milestones')}>
                <h3 style={{ ...eyebrow, margin: '0 0 6px' }}>{t('milestones')}</h3>
                {budget.milestones.length === 0 ? <SectionEmpty message={t('noMilestones')} /> : (
                  <ul style={list}>
                    {budget.milestones.map((m) => (
                      <li key={`${m.milestone}:${m.reachedAt}`} style={row}>
                        <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{m.milestone}</span>
                        <span style={{ color: 'var(--muted)' }}>
                          {t('milestoneMeta', { points: m.earnedPoints, date: date(m.reachedAt) })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-label={t('statement')}>
                <h3 style={{ ...eyebrow, margin: '0 0 6px' }}>{t('statement')}</h3>
                {budget.statement.length === 0 ? <SectionEmpty message={t('noStatement')} /> : (
                  <ul style={list}>
                    {budget.statement.map((s) => (
                      <li key={s.id} style={row}>
                        <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{s.memo ?? t('ticketDone')}</span>
                        <span style={{ color: 'var(--muted)' }}>
                          {t('delta', { count: s.amount })} · {date(s.occurredAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </SlideOutPanel>
    </>
  );
}
