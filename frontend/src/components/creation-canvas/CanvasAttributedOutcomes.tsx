'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Sparkline } from '@/components/charts/Sparkline';
import { colorAt } from '@/components/charts/chartColors';
import { creationSessionsApi, type AttributedOutcomes, type AttributedOutcomeSeries } from '@/lib/builderforceApi';

/**
 * The ATTRIBUTED half of the Idea→delivery panel.
 *
 * The panel it sits inside charts the PROCESS — how fast and how reliably this
 * board produced an artifact, against its peers. That is a productivity report:
 * it can say a board shipped faster than everyone else's and cannot say whether
 * anybody outside the building ever touched what it shipped. A founder does not
 * open this panel to learn their cycle time.
 *
 * The other half was already being written and simply never read here. The
 * growth and canvas rollups stamp `metric_facts.object_id` + a `dimension_key`,
 * and `site_collections.origin_session_id` carries the lineage from a published
 * site back to the session that made it — so `canvas.shipped` on `session:<id>`
 * and `growth.leads` / `growth.conversions` on `site:<id>` are one query away
 * from each other. This reads that query BESIDE the process metrics rather than
 * replacing them: shipping fast and shipping something people used are both
 * true things to know, and only together do they mean anything.
 *
 * Renders nothing at all until it has an answer, so it never displaces the
 * metrics above it with a spinner.
 */

export interface CanvasAttributedOutcomesProps {
  /** The saved session; `null` (an unsaved local board) renders nothing. */
  sessionId: string | null;
}

const SUBTLE: React.CSSProperties = { fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.5 };

export function CanvasAttributedOutcomes({ sessionId }: CanvasAttributedOutcomesProps) {
  const t = useTranslations('creationCanvas.attributed');
  const [data, setData] = useState<AttributedOutcomes | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) { setData(null); return; }
    let live = true;
    setError(null);
    creationSessionsApi.attributedOutcomes(sessionId)
      .then((r) => { if (live) setData(r); })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [sessionId]);

  if (!sessionId) return null;

  return (
    <section
      aria-label={t('title')}
      style={{
        borderTop: '1px solid var(--border-subtle)',
        marginTop: 12,
        paddingTop: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div>
        <strong style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>{t('title')}</strong>
        <div style={SUBTLE}>{t('help')}</div>
      </div>

      {error ? (
        <p role="status" style={SUBTLE}>{error}</p>
      ) : !data ? (
        <p role="status" style={SUBTLE}>{t('loading')}</p>
      ) : data.unpublished ? (
        // Said, not drawn as zero. "Nobody has seen it yet" and "people saw it
        // and did nothing" are different news, and a flat zero line is the same
        // picture for both.
        <p style={SUBTLE}>{t('unpublished')}</p>
      ) : data.series.length === 0 ? (
        <p style={SUBTLE}>{t('noneYet', { days: data.windowDays })}</p>
      ) : (
        <>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.series.map((series, i) => (
              <SeriesRow key={`${series.metric}-${series.subject.kind}-${series.subject.id}`} series={series} index={i} />
            ))}
          </ul>
          <div style={SUBTLE}>{t('window', { days: data.windowDays })}</div>
        </>
      )}
    </section>
  );
}

function SeriesRow({ series, index }: { series: AttributedOutcomeSeries; index: number }) {
  const t = useTranslations('creationCanvas.attributed');
  const tm = useTranslations('creationCanvas.attributed.metric');
  const label = (() => {
    // A metric key the catalog has not been taught yet still reads as itself
    // rather than blanking the row.
    try { return tm(series.metric.replace('.', '_') as never); } catch { return series.metric; }
  })();
  const subject = series.subject.kind === 'site'
    ? (series.subject.label ?? t('siteFallback', { id: series.subject.id }))
    : t('thisBoard');

  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ minWidth: 0, flex: '1 1 auto' }}>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </div>
        <div style={SUBTLE}>{subject}</div>
      </div>
      <Sparkline
        values={series.points.map((p) => p.value)}
        color={colorAt(index)}
        ariaLabel={t('sparkAria', { metric: label, subject })}
      />
      <strong style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
        {Math.round(series.total).toLocaleString()}
      </strong>
    </li>
  );
}
