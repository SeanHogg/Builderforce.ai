'use client';

/**
 * WorkloadPanel — FR-1: Workload Distribution.
 *
 * Per-contributor breakdown of task count, capacity bars, overload highlighting,
 * and filters by team / label / task type.
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Contributor, HealthScoreConfig } from '@/lib/teamHealthTypes';
import { computeOverload } from '@/lib/teamHealthUtils';
import { CollapsibleSection } from './CollapsibleSection';

interface Props {
  contributors: Contributor[];
  config: HealthScoreConfig;
}

export function WorkloadPanel({ contributors, config }: Props) {
  const t = useTranslations('teamHealth');
  const [filterType, setFilterType] = useState<'all' | 'human' | 'agent'>('all');

  const filtered = useMemo(() => {
    if (filterType === 'all') return contributors;
    return contributors.filter((c) => c.type === filterType);
  }, [contributors, filterType]);

  const overloadedCount = useMemo(
    () => filtered.filter((c) => computeOverload(c.tasksAssigned, c.capacity, config).level !== 'ok').length,
    [filtered, config],
  );

  return (
    <CollapsibleSection
      title={t('sectionWorkload')}
      badge={overloadedCount > 0 ? `${overloadedCount} ${t('overloaded')}` : undefined}
      badgeTone="warning"
    >
      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['all', 'human', 'agent'] as const).map((ft) => (
          <button
            key={ft}
            type="button"
            className="th-action-btn"
            style={{
              fontWeight: filterType === ft ? 700 : 400,
              background: filterType === ft ? 'var(--bg-elevated)' : 'transparent',
            }}
            onClick={() => setFilterType(ft)}
          >
            {t(`filter${ft.charAt(0).toUpperCase() + ft.slice(1)}`)}
          </button>
        ))}
      </div>

      <div className="th-table-wrap">
        <table className="th-table">
          <thead>
            <tr>
              <th>{t('colContributor')}</th>
              <th>{t('colType')}</th>
              <th>{t('colTasks')}</th>
              <th>{t('colCompleted')}</th>
              <th>{t('colCapacity')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const overload = computeOverload(c.tasksAssigned, c.capacity, config);
              return (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td style={{ color: 'var(--text-muted)', textTransform: 'capitalize', fontSize: '0.75rem' }}>
                    {c.type}
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{c.tasksAssigned}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                    {c.tasksCompleted}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="th-capacity-bar">
                        <div
                          className={`th-capacity-fill th-capacity-${overload.level === 'critical' ? 'critical' : overload.level === 'warning' ? 'warning' : 'ok'}`}
                          style={{ width: `${Math.min(overload.pct, 100)}%` }}
                        />
                      </div>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                          color:
                            overload.level === 'critical'
                              ? 'var(--th-blocker)'
                              : overload.level === 'warning'
                                ? 'var(--th-overload)'
                                : 'var(--th-green)',
                          whiteSpace: 'nowrap',
                          minWidth: 42,
                        }}
                      >
                        {overload.pct}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', textAlign: 'center', padding: '20px 0' }}>
          {t('noContributors')}
        </p>
      )}
    </CollapsibleSection>
  );
}
