'use client';

/**
 * One anonymous visitor's journey, visit by visit — the evidence behind a number
 * in the flow graph.
 *
 * The graph says 280 visitors stopped at `/pricing`. This says what ONE of them
 * typed, which pages they walked, what broke, how long they stayed, and whether
 * they ever came back — which is the only view that turns a drop-off into a
 * cause. It owns its own fetch and its own visibility (null visitor → nothing),
 * so any surface that has a visitor id can mount it unchanged.
 */

import { useTranslations } from 'next-intl';
import { adminApi, type AdminVisitorJourney, type AdminVisitorJourneyStep } from '@/lib/adminApi';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { AdminError, AdminLoading, useAdminData, useAdminFormat } from '@/components/admin/adminShared';

/** The ink for each step kind — the same vocabulary the graph uses. */
const STEP_COLOR: Record<string, string> = {
  prompt: 'var(--accent)',
  page_view: 'var(--info)',
  visit_start: 'var(--info)',
  error: 'var(--error)',
  visit_end: 'var(--warning)',
};

export function VisitorJourneyDrawer({
  visitorId,
  onClose,
}: {
  visitorId: string | null;
  onClose: () => void;
}) {
  const t = useTranslations('admin.visitorFlow');
  const { fmtDateTime } = useAdminFormat();
  const { data, loading, error } = useAdminData<AdminVisitorJourney | null>(
    () => (visitorId ? adminApi.visitorJourney(visitorId) : Promise.resolve(null)),
    [visitorId],
  );

  if (!visitorId) return null;

  return (
    <SlideOutPanel open onClose={onClose} title={t('journeyTitle')} width="wide">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <code
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            wordBreak: 'break-all',
            background: 'var(--surface-subtle)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '6px 8px',
          }}
        >
          {visitorId}
        </code>

        {loading && <AdminLoading />}
        <AdminError message={error} />

        {data && (
          <>
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              {t('journeySummary', {
                visits: data.totals.visits,
                pageViews: data.totals.pageViews,
                prompts: data.totals.prompts,
                errors: data.totals.errors,
              })}
            </p>

            {data.visits.length === 0 && (
              <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{t('journeyEmpty')}</p>
            )}

            {data.visits.map((visit, index) => (
              <section
                key={visit.visitId ?? `legacy-${index}`}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--surface-card)',
                  padding: 12,
                }}
              >
                <header style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 13, color: 'var(--text-strong)' }}>
                    {/* Visits arrive newest-first, so the LAST one in the list is
                        visit 1 — numbering them from the end is what makes "they
                        came back three times" readable at a glance. */}
                    {t('visitNumber', { number: data.visits.length - index })}
                  </strong>
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    {fmtDateTime(visit.startedAt)}
                    {visit.durationMs !== null && ` · ${formatDuration(visit.durationMs)}`}
                  </span>
                </header>

                <ol style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: 6 }}>
                  {visit.steps.map((step, stepIndex) => (
                    <JourneyStep key={`${step.at}-${stepIndex}`} step={step} at={fmtDateTime(step.at)} />
                  ))}
                </ol>
              </section>
            ))}
          </>
        )}
      </div>
    </SlideOutPanel>
  );
}

function JourneyStep({ step, at }: { step: AdminVisitorJourneyStep; at: string }) {
  const t = useTranslations('admin.visitorFlow');
  const color = STEP_COLOR[step.kind] ?? 'var(--text-muted)';
  const kindLabel = t.has(`kindLabel.${step.kind}`) ? t(`kindLabel.${step.kind}`) : step.kind;

  return (
    <li style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, minWidth: 0 }}>
      <span
        aria-hidden
        style={{ width: 8, height: 8, borderRadius: 4, background: color, marginTop: 5, flexShrink: 0 }}
      />
      <span className="text-muted" style={{ flexShrink: 0, minWidth: 132 }}>{at}</span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{kindLabel}</span>
        {step.path && <span className="text-muted"> · {step.path}</span>}
        {/* The prompt is the highest-signal thing on the timeline, so it renders
            in full rather than being clamped to a preview: this drawer IS the
            place the full text is supposed to be reachable. */}
        {step.prompt && (
          <span
            style={{
              display: 'block',
              marginTop: 4,
              color: 'var(--text-primary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {step.prompt}
          </span>
        )}
      </span>
    </li>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
