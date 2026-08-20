'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import Link from 'next/link';
import { BarChart, type BarDatum } from '@/components/charts/BarChart';
import { managerApi, type StallCensusResponse } from '@/lib/builderforceApi';
import { ticketHref } from '@/lib/ticketHref';
import { useFormat } from "@/i18n/useFormat";

/**
 * The AI Manager's STALL CENSUS and the systemic findings it raised from it.
 *
 * ── WHY THIS SITS BESIDE THE STUCK REGISTER RATHER THAN INSIDE IT ────────────────
 * The register answers "what is stuck, and what has the manager tried?" — per ticket,
 * and only for the tickets its deep triage stage has had budget to diagnose (a dozen
 * per project per pass). That bound is correct for acting and fatal for reading:
 * measured on one tenant, 755 tickets were stalled while the register held 44 rows, so
 * the register's own "what is holding work up" chart was a sample of twelve-at-a-time.
 * Its top cause read "Unclassified"; the truth was 313 tickets sharing ONE cause.
 *
 * So this panel reports the count across EVERY ticket, and states its coverage plainly
 * — how many stalls exist versus how many have been confirmed in depth — because the
 * failure being corrected here is precisely a number that looked complete and was not.
 *
 * ── THE FINDINGS ARE THE POINT ───────────────────────────────────────────────────
 * A cohort of 313 is not 313 ticket problems, it is one defect wearing 313 costumes,
 * and no amount of per-ticket remediation clears it. When a cohort crosses the
 * materiality threshold the manager reasons about the underlying defect and opens a
 * ticket for it. Those findings render first, above the chart: the root cause and the
 * remediation are what a human actually needs, and the distribution is the evidence.
 */

const panelStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};
const sectionTitleStyle: CSSProperties = { fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' };
const mutedStyle: CSSProperties = { color: 'var(--text-muted)', fontSize: '0.8rem' };

/** One headline number. Grid-placed by the caller so the row wraps on a narrow screen. */
function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{
      background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)', padding: '10px 12px', minWidth: 0,
    }}>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, color: tone ?? 'var(--text-primary)', lineHeight: 1.2 }}>
        {value}
      </div>
      <div style={{ ...mutedStyle, marginTop: 2 }}>{label}</div>
    </div>
  );
}

export interface ManagerStallCensusProps {
  projectId: number;
}

export function ManagerStallCensus({ projectId }: ManagerStallCensusProps) {
  const fmt = useFormat();
  const t = useTranslations('manager.census');
  // Cause labels are REUSED from the register's catalog rather than duplicated — one
  // translation per stall cause for the whole surface.
  const tCause = useTranslations('manager.stalls.cause');
  const format = useFormatter();
  const [data, setData] = useState<StallCensusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await managerApi.census(projectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => { void load(); }, [load]);

  const relative = useCallback((iso: string | null): string => {
    if (!iso) return '';
    try {
      return format.relativeTime(new Date(iso), new Date());
    } catch {
      return fmt.dateTime(iso);
    }
  }, [format]);

  const cohortBars: BarDatum[] = useMemo(
    () => (data?.cohorts ?? []).map((c) => ({
      key: c.cause,
      label: tCause(c.cause),
      value: c.count,
      // The faint full-width track is the managed total, so a bar reads as a SHARE of
      // the project rather than only relative to the other bars.
      secondary: data?.managed ?? undefined,
    })),
    [data, tCause],
  );

  const header = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={sectionTitleStyle}>{t('title')}</div>
      <div style={mutedStyle}>{t('caption')}</div>
    </div>
  );

  if (loading && !data) {
    return <section style={panelStyle}>{header}<div style={{ ...mutedStyle, marginTop: 12 }}>{t('loading')}</div></section>;
  }

  if (error && !data) {
    return (
      <section style={panelStyle}>
        {header}
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--danger-text)', fontSize: '0.85rem' }}>{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            style={{
              padding: '4px 10px', borderRadius: 'var(--radius-md)', fontSize: '0.8rem', cursor: 'pointer',
              border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)',
            }}
          >
            {t('retry')}
          </button>
        </div>
      </section>
    );
  }

  if (!data) return null;

  // Coverage is stated whenever the deep stage has confirmed LESS than the census found —
  // the honest reading of a bounded diagnosis, and the exact gap that hid this problem.
  const underCovered = data.stalled > data.deepDiagnosed;

  return (
    <section style={panelStyle}>
      {header}

      <div style={{
        marginTop: 12, display: 'grid', gap: 10,
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
      }}>
        <Stat label={t('stat.managed')} value={String(data.managed)} />
        <Stat
          label={t('stat.stalled')}
          value={String(data.stalled)}
          tone={data.stalled > 0 ? 'var(--warning-text)' : undefined}
        />
        <Stat label={t('stat.moving')} value={String(data.moving)} />
        <Stat label={t('stat.deepDiagnosed')} value={String(data.deepDiagnosed)} />
      </div>

      {underCovered && (
        <p style={{ ...mutedStyle, marginTop: 10, marginBottom: 0 }}>
          {t('coverageNote', { stalled: data.stalled, diagnosed: data.deepDiagnosed })}
        </p>
      )}

      {/* Findings first: the root cause and the fix outrank the distribution. */}
      {data.findings.length > 0 && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={sectionTitleStyle}>{t('findings.title')}</div>
          <div style={mutedStyle}>{t('findings.caption')}</div>
          {data.findings.map((f) => (
            <article
              key={f.id}
              style={{
                background: 'var(--bg-base)',
                border: '1px solid var(--warning-border, var(--border-subtle))',
                borderLeft: '3px solid var(--warning-text)',
                borderRadius: 'var(--radius-lg)', padding: 12,
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                  {t('findings.headline', { count: f.ticketCount, cause: tCause(f.cause) })}
                </span>
                <span style={mutedStyle}>
                  {f.source === 'ai' ? t('findings.sourceAi') : t('findings.sourceHeuristic')}
                </span>
              </div>

              <p style={{ margin: '8px 0 0', fontSize: '0.85rem', color: 'var(--text-primary)' }}>{f.summary}</p>

              <p style={{ margin: '8px 0 0', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                <strong>{t('findings.remediation')}</strong>{' '}
                <span style={{ color: 'var(--text-secondary, var(--text-primary))' }}>{f.remediation}</span>
              </p>

              <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                {f.createdTaskId != null && (
                  <Link
                    href={ticketHref(f.createdTaskId)}
                    style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent)' }}
                  >
                    {t('findings.openTicket', { key: f.createdTaskKey ?? `#${f.createdTaskId}` })}
                  </Link>
                )}
                <span style={mutedStyle}>{t('findings.raised', { when: relative(f.firstSeenAt) })}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      {data.cohorts.length > 0 ? (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={sectionTitleStyle}>{t('cohorts.title')}</div>
          {/* Wide content scrolls inside its own box; the page body never scrolls sideways. */}
          <div style={{ overflowX: 'auto' }}>
            <BarChart data={cohortBars} maxRows={8} labelWidth={168} ariaLabel={t('cohorts.aria')} />
          </div>
        </div>
      ) : (
        <p style={{ ...mutedStyle, marginTop: 16, marginBottom: 0 }}>{t('empty')}</p>
      )}

      <p style={{ ...mutedStyle, marginTop: 12, marginBottom: 0 }}>
        {t('computedAt', { when: relative(data.computedAt) })}
      </p>
    </section>
  );
}
