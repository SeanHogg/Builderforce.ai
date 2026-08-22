'use client';

/**
 * Visitor flow — the anonymous funnel as a graph, with its conversion gaps.
 *
 * Answer-first, matching the other console panels: the six numbers that say
 * whether the funnel is working lead, the graph that says WHERE it stops
 * follows, and one visitor's evidence is a click away.
 *
 * It replaced `DemoFunnelPanel`, a persona × stage COUNT matrix over the same
 * stream. That matrix could say 400 visitors reached `convert_prompt_shown`; it
 * could never say that 300 of them arrived straight from their first prompt and
 * 280 stopped there — which is the entire question a funnel is read to answer.
 * Persona is still on every row, so the demo funnel is one slice of this rather
 * than a screen of its own.
 *
 * Composition, not one file: this owns the fetch, the window control and the
 * headline row; `VisitorFlowGraph` draws; `VisitorJourneyDrawer` fetches and
 * renders one visitor. Each is usable on its own surface.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type AdminVisitorFlow } from '@/lib/adminApi';
import {
  AdminError,
  AdminLoading,
  AdminPanelHeader,
  useAdminData,
  useAdminFormat,
} from '@/components/admin/adminShared';
import { VisitorFlowGraph } from '@/components/admin/visitor-flow/VisitorFlowGraph';
import { VisitorJourneyDrawer } from '@/components/admin/visitor-flow/VisitorJourneyDrawer';

/** The windows the graph can be read over. Data, so a new one is a row. */
const WINDOWS = [7, 30, 90] as const;

export default function VisitorFlowPanel() {
  const t = useTranslations('admin.visitorFlow');
  const { fmtNum } = useAdminFormat();
  const [days, setDays] = useState<number>(30);
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const { data, loading, error, reload } = useAdminData<AdminVisitorFlow>(
    () => adminApi.visitorFlow(days),
    [days],
  );

  const totals = data?.totals;
  const promptRate = rate(totals?.visitsWithPrompt, totals?.visits);
  const conversionRate = rate(totals?.convertedVisitors, totals?.visitors);

  return (
    <div>
      <AdminPanelHeader
        title={t('title')}
        subtitle={t('subtitle')}
        onRefresh={reload}
        actions={
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {WINDOWS.map((window) => (
              <button
                key={window}
                type="button"
                className={window === days ? 'btn-secondary' : 'btn-ghost'}
                aria-pressed={window === days}
                onClick={() => setDays(window)}
              >
                {t('window', { days: window })}
              </button>
            ))}
          </div>
        }
      />

      {loading && <AdminLoading />}
      <AdminError message={error} />

      {data && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
            <Stat label={t('stat.visitors')} value={fmtNum(totals?.visitors ?? 0)} />
            <Stat label={t('stat.visits')} value={fmtNum(totals?.visits ?? 0)} />
            <Stat
              label={t('stat.returning')}
              value={fmtNum(totals?.returningVisitors ?? 0)}
              hint={t('stat.returningHint')}
            />
            <Stat
              label={t('stat.withPrompt')}
              value={fmtNum(totals?.visitsWithPrompt ?? 0)}
              hint={promptRate}
            />
            <Stat
              label={t('stat.withError')}
              value={fmtNum(totals?.visitsWithError ?? 0)}
              hint={t('stat.withErrorHint')}
              tone={(totals?.visitsWithError ?? 0) > 0 ? 'error' : undefined}
            />
            <Stat
              label={t('stat.converted')}
              value={fmtNum(totals?.convertedVisitors ?? 0)}
              hint={conversionRate}
              tone="success"
            />
          </div>

          {/* A bounded scan must say so. A graph drawn from the most recent
              slice reads exactly like a complete one unless it admits it. */}
          {data.truncated && (
            <p
              className="text-muted"
              style={{ fontSize: 12, margin: '0 0 12px', color: 'var(--warning-text, var(--warning))' }}
            >
              {t('truncated')}
            </p>
          )}

          <VisitorFlowGraph nodes={data.nodes} edges={data.edges} />

          <p className="text-muted" style={{ fontSize: 12, marginTop: 12 }}>
            {t('drillHint')}
          </p>
          <form
            style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}
            onSubmit={(e) => {
              e.preventDefault();
              const value = new FormData(e.currentTarget).get('visitorId');
              if (typeof value === 'string' && value.trim()) setVisitorId(value.trim());
            }}
          >
            <input
              name="visitorId"
              className="input"
              placeholder={t('visitorPlaceholder')}
              aria-label={t('visitorPlaceholder')}
              style={{ flex: '1 1 240px', minWidth: 0 }}
            />
            <button type="submit" className="btn-secondary">{t('openJourney')}</button>
          </form>
        </>
      )}

      <VisitorJourneyDrawer visitorId={visitorId} onClose={() => setVisitorId(null)} />
    </div>
  );
}

/** One headline number. Same tile the guest-sessions funnel uses, at this scope. */
function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'success' | 'error';
}) {
  const toneColor = tone === 'success' ? 'var(--success)' : tone === 'error' ? 'var(--error)' : 'var(--text-strong)';
  return (
    <div
      style={{
        flex: '1 1 140px',
        minWidth: 120,
        padding: '12px 14px',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--surface-card)',
      }}
    >
      <div
        className="text-muted"
        style={{ fontSize: 'var(--font-size-eyebrow)', textTransform: 'uppercase', letterSpacing: '.04em' }}
      >
        {label}
      </div>
      <div style={{ fontSize: 'var(--font-size-section)', fontWeight: 700, color: toneColor, marginTop: 2 }}>
        {value}
      </div>
      {hint && <div className="text-muted" style={{ fontSize: 'var(--font-size-eyebrow)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function rate(part: number | undefined, whole: number | undefined): string | undefined {
  if (!whole || part === undefined) return undefined;
  return `${Math.round((part / whole) * 100)}%`;
}
