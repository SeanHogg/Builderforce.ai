/**
 * The Overview's top lists (PRD 33 §2.1 "Dashboard"): pages, entry and exit
 * pages, referrers, countries, devices, browsers and operating systems — the
 * `OVERVIEW_BREAKDOWNS` registry, each naming the filter field its rows
 * narrow to. A row click adds that clause to the ONE filter, so the whole
 * view (and every band behind the panel) re-reads for that slice.
 */

import { useTranslations } from 'next-intl';
import {
  FILTER_FIELD_BY_ID,
  parseReplayFilter,
  type FilterFieldId,
  type ReplayFilterClause,
  type ReplayOverviewDto,
  type ReplayOverviewTopKey,
} from '@builderforce/interaction-contract';
import { useFormat } from '@/i18n/useFormat';

export interface OverviewBreakdownDef {
  key: ReplayOverviewTopKey;
  /** The filter field a row narrows to. */
  field: FilterFieldId;
}

export const OVERVIEW_BREAKDOWNS: ReadonlyArray<OverviewBreakdownDef> = [
  { key: 'pages', field: 'visitedPath' },
  { key: 'entryPages', field: 'entryPath' },
  { key: 'exitPages', field: 'exitPath' },
  { key: 'referrers', field: 'referrer' },
  { key: 'countries', field: 'country' },
  { key: 'devices', field: 'device' },
  { key: 'browsers', field: 'browser' },
  { key: 'os', field: 'os' },
];

/** The `eq` clause a row adds, or null when the value is not one the filter accepts. */
export function breakdownClause(field: FilterFieldId, value: string): ReplayFilterClause | null {
  return parseReplayFilter({ all: [{ field, op: 'eq', value }] })?.all[0] ?? null;
}

export interface OverviewBreakdownsProps {
  overview: ReplayOverviewDto;
  onAdd: (clause: ReplayFilterClause) => void;
}

export function OverviewBreakdowns({ overview, onAdd }: OverviewBreakdownsProps) {
  const t = useTranslations('replay.overview');
  const tFilter = useTranslations('replay.filter');
  const fmt = useFormat();
  const count = (n: number) => (overview.estimated ? t('approx', { value: fmt.number(n) }) : fmt.number(n));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-3)', minWidth: 0 }}>
      {OVERVIEW_BREAKDOWNS.map((breakdown) => {
        const rows = overview.top[breakdown.key] ?? [];
        const max = Math.max(1, ...rows.map((row) => row.sessions));
        const enumField = FILTER_FIELD_BY_ID.get(breakdown.field)?.valueKind === 'enum';
        const title = t(`top.${breakdown.key}`);
        return (
          <section
            key={breakdown.key}
            aria-label={title}
            style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-card)', padding: 'var(--space-2)', minWidth: 0 }}
          >
            <h4 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{title}</h4>
            {rows.length === 0 && <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('topEmpty')}</p>}
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {rows.map((row) => {
                const clause = breakdownClause(breakdown.field, row.value);
                const label = enumField ? tFilter(`value.${row.value}`) : row.value || t('unknown');
                return (
                  <li key={row.value}>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={!clause}
                      aria-label={t('addFilterAria', { label, field: tFilter(`field.${breakdown.field}`) })}
                      onClick={() => { if (clause) onAdd(clause); }}
                      style={{ position: 'relative', width: '100%', minHeight: 44, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', justifyContent: 'space-between', textAlign: 'left', overflow: 'hidden' }}
                    >
                      <span
                        aria-hidden="true"
                        style={{ position: 'absolute', inset: '6px auto 6px 0', width: `${(row.sessions / max) * 100}%`, background: 'var(--accent)', opacity: 0.12, borderRadius: 'var(--radius-sm)' }}
                      />
                      <span style={{ position: 'relative', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{label}</span>
                      <span style={{ position: 'relative', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', fontSize: 'var(--font-size-small)' }}>{count(row.sessions)}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
