/**
 * Pure formatting for an on-device model row — what the row SAYS, separated from how it
 * renders so the copy rules are testable and shared by every host's list.
 *
 * Numbers go through `Intl` with the host's locale (undefined = the runtime's), so a
 * download size reads "1.2 GB" in English and "1,2 GB" in German without a catalog
 * entry per unit.
 */
import type { LocalModelRow } from '@seanhogg/builderforce-brain-embedded';
import { fill } from '../spend/format';
import { LOCAL_UNSUPPORTED_LABEL, type LocalModelLabels } from './labels';

const GB = 1_000_000_000;
const MB = 1_000_000;

/** A download size: gigabytes to one decimal from 1 GB up, whole megabytes below. */
export function formatDownloadSize(bytes: number, locale?: string): string {
  const big = bytes >= GB;
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: big ? 'gigabyte' : 'megabyte',
    maximumFractionDigits: big ? 1 : 0,
  }).format(big ? bytes / GB : Math.max(1, Math.round(bytes / MB)));
}

/** A parameter count in compact notation ("8.2B"). */
export function formatParams(params: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(params);
}

/** A context window in the "32K" form model cards use. */
export function formatContextTokens(tokens: number): string {
  return `${Math.round(tokens / 1024)}K`;
}

/** The secondary line of a row: params · context window. */
export function localModelMeta(row: LocalModelRow, labels: LocalModelLabels, locale?: string): string {
  return [formatParams(row.params, locale), fill(labels.localContext, { tokens: formatContextTokens(row.contextTokens) })].join(' · ');
}

/** Why an unsupported row cannot run, in the host's words. */
export function unsupportedReason(row: LocalModelRow, labels: LocalModelLabels): string {
  return labels[LOCAL_UNSUPPORTED_LABEL[row.reason ?? 'engine_unavailable']];
}

/** Download progress as a whole percentage, clamped. */
export function progressPercent(row: LocalModelRow): number {
  return Math.max(0, Math.min(100, Math.round((row.progress ?? 0) * 100)));
}
