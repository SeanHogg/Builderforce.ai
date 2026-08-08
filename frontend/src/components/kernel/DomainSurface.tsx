'use client';

/**
 * ONE domain surface, composed from the kernel components (PRD 20 §7.1).
 *
 * "134 `page.tsx` routes exist today. The target is not 134 rewritten pages — it
 * is **15 domain surfaces plus the canvas**, each composed from the kernel
 * components above." This is those fifteen: a single component, parameterised by
 * seat, because after the consolidation every seat answers the same four
 * questions through the same four endpoints.
 *
 * Fifteen near-identical components would be exactly the duplication §0 forbids
 * one layer down — and the reason it is avoidable here is the reason the schema
 * came first: there is one shape to render.
 *
 * §7.2 STANDARDS, in this pass and not a follow-up:
 *   · every colour through a theme token, contrast checked in both themes;
 *   · fluid layout — `auto-fit`/`minmax` grids, no fixed px that overflow at
 *     360px, horizontal scroll only inside the chart's own container;
 *   · every visible string through `next-intl`, real translations in all five
 *     catalogs;
 *   · shared components decide their own visibility — nothing here drills a
 *     `canX` boolean.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  getDomainItems,
  getDomainMetrics,
  getDomainSummary,
  type Domain,
  type DomainSummary,
  type MetricSeries,
  type ObjectRef,
} from '@/lib/kernel/kernelApi';
import { EntityBrowser } from './EntityBrowser';
import { MetricChart } from './MetricChart';
import { ObjectTimeline } from './ObjectTimeline';

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-lg px-4 py-3 min-w-0"
      style={{ background: 'var(--surface, #101624)', border: '1px solid var(--border-subtle)' }}
    >
      <p className="m-0 text-[0.65rem] uppercase tracking-wider truncate" style={{ color: 'var(--text-muted)' }}>
        {label}
      </p>
      <p className="m-0 text-2xl font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
        {value}
      </p>
    </div>
  );
}

export function DomainSurface({
  domain,
  onOpenObject,
  locale = 'en',
}: {
  domain: Domain;
  /**
   * Opening an item is RAISED, not owned.
   *
   * "ONE detail route" (§7.1) has to mean one MOUNTED panel too: a surface that
   * owned its own `<ObjectPanel>` while the shell owned another gave two
   * independent slide-outs at the same fixed position, and both could be open at
   * once. One owner, one panel.
   */
  onOpenObject?: (objectId: string) => void;
  locale?: string;
}) {
  const t = useTranslations('kernel.surface');
  const tDomain = useTranslations('kernel.roster');
  const [summary, setSummary] = useState<DomainSummary | null>(null);
  const [items, setItems] = useState<ObjectRef[] | null>(null);
  const [metrics, setMetrics] = useState<MetricSeries[]>([]);

  const load = useCallback(async () => {
    // Fanned out in parallel, and each leg degrades on its own: one slow lens
    // must never blank the surface.
    const [s, i, m] = await Promise.all([
      getDomainSummary(domain).catch(() => null),
      getDomainItems(domain, { limit: 25 }).catch(() => [] as ObjectRef[]),
      getDomainMetrics(domain).catch(() => [] as MetricSeries[]),
    ]);
    setSummary(s);
    setItems(i);
    setMetrics(m);
  }, [domain]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex flex-col gap-5 min-w-0 p-4 sm:p-6">
      <header className="flex flex-col gap-1 min-w-0">
        <p className="m-0 text-[0.65rem] uppercase tracking-[0.17em]" style={{ color: 'var(--accent)' }}>
          {summary ? t('ownedBy', { seat: summary.seat }) : ' '}
        </p>
        <h1 className="m-0 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          {tDomain(`domain.${domain}`)}
        </h1>
        <p className="m-0 text-sm max-w-[60ch]" style={{ color: 'var(--text-secondary)' }}>
          {t(`blurb.${domain}`)}
        </p>
      </header>

      {/* Fluid: as many tiles as fit, never a fixed track count that overflows. */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <StatTile label={t('stat.items')} value={summary ? String(summary.itemCount) : '—'} />
        <StatTile label={t('stat.recentEvents')} value={summary ? String(summary.recentEventCount) : '—'} />
        <StatTile
          label={t('stat.lastActivity')}
          value={summary?.lastActivityAt ? new Date(summary.lastActivityAt).toLocaleDateString(locale) : '—'}
        />
      </div>

      <section
        className="rounded-lg p-4 min-w-0"
        style={{ background: 'var(--surface, #101624)', border: '1px solid var(--border-subtle)' }}
        aria-label={t('section.metrics')}
      >
        <h2 className="m-0 mb-3 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t('section.metrics')}
        </h2>
        <MetricChart series={metrics} locale={locale} />
      </section>

      <div className="grid gap-4 min-w-0" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <section
          className="rounded-lg p-4 min-w-0"
          style={{ background: 'var(--surface, #101624)', border: '1px solid var(--border-subtle)' }}
          aria-label={t('section.items')}
        >
          <h2 className="m-0 mb-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {t('section.items')}
          </h2>
          {items === null ? (
            <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>{t('loading')}</p>
          ) : items.length === 0 ? (
            <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>{t('noItems')}</p>
          ) : (
            <ul className="m-0 p-0 list-none flex flex-col">
              {items.map((item) => (
                <li key={item.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <button
                    type="button"
                    onClick={() => onOpenObject?.(item.id)}
                    className="flex items-center gap-2 w-full py-2 text-left min-w-0"
                    style={{ background: 'transparent', border: 'none' }}
                  >
                    <span className="flex-1 min-w-0 truncate text-sm" style={{ color: 'var(--text-primary)' }}>
                      {item.title ?? item.kind}
                    </span>
                    <span
                      className="shrink-0 text-[0.6rem] uppercase tracking-wider rounded px-1.5 py-0.5"
                      style={{ background: 'var(--surface-2, rgba(255,255,255,0.08))', color: 'var(--text-muted)' }}
                    >
                      {item.kind}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          className="rounded-lg p-4 min-w-0"
          style={{ background: 'var(--surface, #101624)', border: '1px solid var(--border-subtle)' }}
          aria-label={t('section.activity')}
        >
          <h2 className="m-0 mb-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {t('section.activity')}
          </h2>
          {/* The SAME timeline component the object panel mounts. */}
          <ObjectTimeline domain={domain} limit={20} locale={locale} />
        </section>
      </div>

      {/* The seat's own tables. ONE browser, fed by the seat's metadata — this is
          where the consolidated schema stops being a schema and becomes a
          surface (§5 step 5). */}
      <section
        className="rounded-lg p-4 min-w-0"
        style={{ background: 'var(--surface, #101624)', border: '1px solid var(--border-subtle)' }}
        aria-label={t('section.records')}
      >
        <h2 className="m-0 mb-3 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t('section.records')}
        </h2>
        <EntityBrowser scope={domain} locale={locale} />
      </section>

      {/* The kernel's primitives are shared, not this seat's — every seat reads
          the same twenty-five (§2), so they are shown as shared rather than
          copied into fifteen seat-shaped views. */}
      <section
        className="rounded-lg p-4 min-w-0"
        style={{ background: 'var(--surface, #101624)', border: '1px solid var(--border-subtle)' }}
        aria-label={t('section.kernel')}
      >
        <h2 className="m-0 mb-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t('section.kernel')}
        </h2>
        <p className="m-0 mb-3 text-xs max-w-[60ch]" style={{ color: 'var(--text-muted)' }}>
          {t('kernelBlurb')}
        </p>
        <EntityBrowser scope="kernel" locale={locale} />
      </section>
    </div>
  );
}
