/**
 * The recordings table's columns, as data.
 *
 * Each row names its header key, its ascending comparator and its cell, so the
 * list renders `RECORDING_COLUMNS.map(...)` and a new column is one row here —
 * never a new branch in the table.
 */

import type { ComponentType } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayRecordingSummaryDto } from '@builderforce/interaction-contract';
import { useFormat } from '@/i18n/useFormat';
import { Icon, type IconName } from '@/components/ui/Icon';
import { fmtClock } from './replayMarks';

type Row = ReplayRecordingSummaryDto;

export type RecordingColumnId = 'when' | 'where' | 'release' | 'pages' | 'duration' | 'signals' | 'keep';

export interface RecordingColumn {
  id: RecordingColumnId;
  /** Under `replay.list`. */
  labelKey: string;
  compare: (a: Row, b: Row) => number;
  Cell: ComponentType<{ row: Row }>;
}

const muted = { color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' } as const;

function signalTotal(row: Row): number {
  const c = row.counts;
  return c.rage + c.dead + c.errors + c.quickbacks + c.excessiveScrolls;
}

function WhenCell({ row }: { row: Row }) {
  const fmt = useFormat();
  return <span style={muted}>{fmt.dateWith(row.startedAt, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>;
}

function WhereCell({ row }: { row: Row }) {
  const t = useTranslations('replay.list');
  const same = row.entryPath === row.exitPath;
  return (
    <span style={{ overflowWrap: 'anywhere', color: 'var(--text-primary)' }}>
      {same ? row.entryPath : t('route', { entry: row.entryPath, exit: row.exitPath })}
    </span>
  );
}

function ReleaseCell({ row }: { row: Row }) {
  return <code style={{ ...muted, fontFamily: 'var(--font-mono, monospace)' }}>{row.releaseKey.slice(0, 12)}</code>;
}

function PagesCell({ row }: { row: Row }) {
  const fmt = useFormat();
  return <span>{fmt.number(row.pageCount)}</span>;
}

function DurationCell({ row }: { row: Row }) {
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtClock(row.durationMs)}</span>;
}

const SIGNALS: ReadonlyArray<{ key: keyof Row['counts']; icon: IconName; tone: string; labelKey: string }> = [
  { key: 'rage', icon: 'alert', tone: 'var(--error)', labelKey: 'signal.rage' },
  { key: 'dead', icon: 'cursor', tone: 'var(--warning)', labelKey: 'signal.dead' },
  { key: 'errors', icon: 'warning', tone: 'var(--error)', labelKey: 'signal.errors' },
  { key: 'quickbacks', icon: 'chevron-left', tone: 'var(--warning)', labelKey: 'signal.quickbacks' },
];

function SignalsCell({ row }: { row: Row }) {
  const t = useTranslations('replay.list');
  const shown = SIGNALS.filter((signal) => row.counts[signal.key] > 0);
  if (shown.length === 0) return <span style={muted}>{t('noSignals')}</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
      {shown.map((signal) => (
        <span
          key={signal.key}
          role="img"
          aria-label={t(signal.labelKey, { count: row.counts[signal.key] })}
          title={t(signal.labelKey, { count: row.counts[signal.key] })}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: signal.tone }}
        >
          <Icon name={signal.icon} size={14} />
          <span aria-hidden="true" style={{ fontSize: 'var(--font-size-small)' }}>{row.counts[signal.key]}</span>
        </span>
      ))}
    </span>
  );
}

function KeepCell({ row }: { row: Row }) {
  const t = useTranslations('replay.list');
  const fmt = useFormat();
  const weighted = row.keepReason === 'sample' && row.sampleWeight > 1;
  return (
    <span style={muted}>
      {t(`keepReason.${row.keepReason}`)}
      {weighted && <> · {t('weighted', { weight: fmt.number(row.sampleWeight, { maximumFractionDigits: 1 }) })}</>}
    </span>
  );
}

export const RECORDING_COLUMNS: ReadonlyArray<RecordingColumn> = [
  { id: 'when', labelKey: 'when', compare: (a, b) => a.startedAt.localeCompare(b.startedAt), Cell: WhenCell },
  { id: 'where', labelKey: 'where', compare: (a, b) => a.entryPath.localeCompare(b.entryPath), Cell: WhereCell },
  { id: 'release', labelKey: 'release', compare: (a, b) => a.releaseKey.localeCompare(b.releaseKey), Cell: ReleaseCell },
  { id: 'pages', labelKey: 'pages', compare: (a, b) => a.pageCount - b.pageCount, Cell: PagesCell },
  { id: 'duration', labelKey: 'duration', compare: (a, b) => a.durationMs - b.durationMs, Cell: DurationCell },
  { id: 'signals', labelKey: 'signals', compare: (a, b) => signalTotal(a) - signalTotal(b), Cell: SignalsCell },
  { id: 'keep', labelKey: 'keep', compare: (a, b) => a.keepReason.localeCompare(b.keepReason), Cell: KeepCell },
];

export const RECORDING_COMPARATORS = Object.fromEntries(
  RECORDING_COLUMNS.map((column) => [column.id, column.compare]),
) as Record<RecordingColumnId, (a: Row, b: Row) => number>;
