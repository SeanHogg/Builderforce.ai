/**
 * The local-first rail pieces (G21 / G23): a sync-status badge, a freshness line and the
 * sync-summary header. Presentational, theme-token driven (`../tokens`, so light and dark both
 * work) and wrapping at narrow widths. A host passes them to `ChatTicketsPanel` through its
 * optional props; the web app passes none.
 */
import type React from 'react';
import { fill } from '../../spend/format';
import { V } from '../tokens';
import type { LocalRailLabels } from './labels';
import type { RailFreshnessVM, RailSyncStatus, RailSyncSummaryVM } from './vm';

/** Status colours: the rail's ONE palette (`../tokens`), never a second set of literals. */
const STATUS_COLOR: Record<RailSyncStatus, string> = {
  pending: V.muted,
  syncing: V.accent,
  synced: V.success,
  conflict: V.warning,
  'dead-letter': V.danger,
};

const badge: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, lineHeight: 1.3, color: V.text2,
  padding: '1px 6px', borderRadius: 999, border: `1px solid ${V.border}`, maxWidth: '100%', minWidth: 0,
};
const line: React.CSSProperties = { fontSize: 11, color: V.muted, overflowWrap: 'anywhere', minWidth: 0 };
const summaryRow: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 2, minWidth: 0,
  fontSize: 11, color: V.muted, padding: '2px 0',
};

export function statusWord(status: RailSyncStatus, labels: LocalRailLabels): string {
  switch (status) {
    case 'synced': return labels.syncStatusSynced;
    case 'syncing': return labels.syncStatusSyncing;
    case 'conflict': return labels.syncStatusConflict;
    case 'dead-letter': return labels.syncStatusDeadLetter;
    default: return labels.syncStatusPending;
  }
}

/** A small pill: a status dot and its word. */
export function SyncStatusBadge({ status, labels }: { status: RailSyncStatus; labels: LocalRailLabels }) {
  const word = statusWord(status, labels);
  return (
    <span style={badge} role="status" aria-label={fill(labels.syncStatusAria, { status: word })} title={word}>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLOR[status], flex: '0 0 auto' }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{word}</span>
    </span>
  );
}

function timeText(iso: string, locale?: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString(locale);
}

/**
 * "Updated <time>" once the rail was taken from the platform; before that, a bound chat says it was
 * "Not read from the platform yet" and only a chat that lives on this device alone says so.
 */
export function RailFreshnessLine({ freshness, labels, locale }: { freshness: RailFreshnessVM; labels: LocalRailLabels; locale?: string }) {
  const text = freshness.lastIngestedAt
    ? fill(labels.freshnessUpdated, { time: timeText(freshness.lastIngestedAt, locale) })
    : freshness.source === 'device' ? labels.freshnessDeviceOnly : labels.freshnessNever;
  return <span style={line}>{text}</span>;
}

/**
 * A ticket's label, or, for one stored untitled (linked before the device read it), its tier's
 * name and ref in the reader's language: formatted here, at render time, never stored.
 */
export function railTicketLabel(label: string, kindName: string, ref: string, labels: LocalRailLabels): string {
  return label || fill(labels.untitledTicket, { kind: kindName, ref });
}

/** A byte count in the host's units and number format. */
export function sizeText(bytes: number, labels: LocalRailLabels, locale?: string): string {
  const number = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 1 });
  if (bytes < 1024) return fill(labels.sizeBytes, { n: number(bytes) });
  if (bytes < 1024 * 1024) return fill(labels.sizeKilobytes, { n: number(bytes / 1024) });
  return fill(labels.sizeMegabytes, { n: number(bytes / (1024 * 1024)) });
}

function modeWord(mode: RailSyncSummaryVM['mode'], labels: LocalRailLabels): string {
  if (mode === 'local-only') return labels.summaryModeLocalOnly;
  if (mode === 'specific') return labels.summaryModeSpecific;
  return labels.summaryModeHybrid;
}

/** The device's sync summary as one wrapping row of facts. */
export function RailSyncSummary({ summary, labels, locale }: { summary: RailSyncSummaryVM; labels: LocalRailLabels; locale?: string }) {
  const when = (iso: string | undefined) => (iso ? timeText(iso, locale) : labels.summaryNever);
  return (
    <div style={summaryRow} role="group" aria-label={labels.summaryAria}>
      <span>{fill(labels.summaryMode, { mode: modeWord(summary.mode, labels) })}</span>
      <span>{summary.destination.kind === 'bound' ? fill(labels.summaryDestination, { destination: summary.destination.label }) : labels.summaryNoAccount}</span>
      <span>{fill(labels.summaryQueued, { n: summary.queued.items, size: sizeText(summary.queued.bytes, labels, locale) })}</span>
      <span style={summary.conflicts > 0 ? { color: STATUS_COLOR.conflict } : undefined}>
        {fill(labels.summaryConflicts, { n: summary.conflicts })}
      </span>
      <span style={summary.deadLetters > 0 ? { color: STATUS_COLOR['dead-letter'] } : undefined}>{fill(labels.summaryDeadLetters, { n: summary.deadLetters })}</span>
      <span>{fill(labels.summaryLastPush, { time: when(summary.lastPushAt) })}</span>
      <span>{fill(labels.summaryLastPull, { time: when(summary.lastPullAt) })}</span>
    </div>
  );
}
