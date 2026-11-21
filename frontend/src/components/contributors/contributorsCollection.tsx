import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { CollectionDescriptor } from '@/components/collection/descriptor';
import type { ContributorCalendar } from '@/lib/builderforceApi';
import { useFormat } from '@/i18n/useFormat';
import { MetricRecordCard } from '@/components/workforce/MetricRecordCard';

/**
 * The contributor leaderboard as a Collection (PRD 47). READ-ONLY
 * (`entity: null`): profile consolidation (the `contributor` merge port) lives on
 * the Workforce directory, so this surface is activity-only. Selecting a
 * contributor focuses the heat-calendar above on them.
 */

/** A leaderboard row: the contributor plus their rank by total contributions. */
export type RankedContributor = ContributorCalendar & { rank: number };

export function rankContributors(contributors: ContributorCalendar[]): RankedContributor[] {
  return [...contributors].sort((a, b) => b.total - a.total).map((c, i) => ({ ...c, rank: i + 1 }));
}

export const contributorSearch = (c: RankedContributor) => `${c.displayName} ${c.jobTitle ?? ''}`;

export function KindBadge({ kind }: { kind: 'human' | 'agent' }) {
  const t = useTranslations('contributors');
  const color = kind === 'agent' ? 'var(--violet-bright)' : 'var(--emerald-bright)';
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 'var(--radius-full)', whiteSpace: 'nowrap',
      color,
      background: `color-mix(in srgb, ${color} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
    }}>
      {kind === 'agent' ? t('badge.agent') : t('badge.human')}
    </span>
  );
}

export function useContributorsDescriptor(selected: number | null, onSelect: (id: number) => void): CollectionDescriptor<RankedContributor> {
  const t = useTranslations('contributors');
  const fmt = useFormat();
  return useMemo<CollectionDescriptor<RankedContributor>>(() => {
    const name = (c: RankedContributor) => (
      <button
        type="button"
        onClick={() => onSelect(c.id)}
        aria-pressed={selected === c.id}
        title={t('showCalendar')}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'start',
          fontWeight: 600, fontSize: 14, overflowWrap: 'anywhere',
          color: selected === c.id ? 'var(--accent)' : 'var(--text-strong)',
        }}
      >
        {c.displayName}
      </button>
    );
    return {
      entity: null,
      surfaceKey: 'contributors.leaderboard',
      rowId: (c) => String(c.id),
      label: (c) => c.displayName,
      defaultView: 'card',
      defaultSort: { key: 'rank', dir: 'asc' },
      emptyKey: 'emptyContributors',
      columns: [
        { key: 'rank', header: t('col.rank'), width: '56px', compare: (a, b) => a.rank - b.rank,
          cell: (c) => <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{c.rank}</span> },
        { key: 'contributor', header: t('col.contributor'), compare: (a, b) => a.displayName.localeCompare(b.displayName), cell: name },
        { key: 'type', header: t('col.type'), compare: (a, b) => a.kind.localeCompare(b.kind), cell: (c) => <KindBadge kind={c.kind} /> },
        { key: 'role', header: t('col.role'), compare: (a, b) => (a.jobTitle ?? '').localeCompare(b.jobTitle ?? ''),
          cell: (c) => <span style={{ color: 'var(--text-muted)' }}>{c.jobTitle ?? '—'}</span> },
        { key: 'contributions', header: t('col.contributions'), align: 'end', compare: (a, b) => a.total - b.total,
          cell: (c) => <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt.number(c.total)}</span> },
      ],
      card: (c) => (
        <MetricRecordCard
          title={name(c)}
          subtitle={c.jobTitle ?? undefined}
          badge={<KindBadge kind={c.kind} />}
          stats={[
            { label: t('col.contributions'), value: fmt.number(c.total), strong: true },
            { label: t('col.rank'), value: c.rank },
          ]}
        />
      ),
    };
  }, [t, fmt, selected, onSelect]);
}
