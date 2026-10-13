/**
 * A visit as TEXT for a model to read (PRD 33 §2 D13, §8 S4c) — pure.
 *
 * The digest is built from the recording's row and its timeline marks only: a
 * header (device, release, duration, entry → exit, tags) and one line per mark,
 * `[mm:ss #ord] kind key "label"`, capped at {@link DIGEST_MAX_LINES}. It never
 * carries page text: no snapshot, no DOM, no input — the mark key is a route, a
 * selector, an event name or an error fingerprint, and the label is the short,
 * recorder-masked element label the timeline already shows.
 *
 * `#ord` is the mark's index in the recording's timeline, which is what a summary
 * sentence cites and what the player seeks to.
 */

import type { ReplayMark } from '@builderforce/interaction-contract';

export const DIGEST_MAX_LINES = 300;
const KEY_MAX = 120;
const LABEL_MAX = 80;
const TAGS_MAX = 10;

export interface DigestRecording {
  deviceClass: string;
  releaseKey: string;
  durationMs: number;
  entryPath: string;
  exitPath: string;
  tags: Record<string, string>;
  browser?: string | null;
  os?: string | null;
}

/** One line of the digest may not break the line format. */
function clean(value: string, max: number): string {
  const flat = value.replace(/[\r\n\t]+/g, ' ').replace(/"/g, "'").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** `mm:ss` (minutes keep counting past 59). */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return total >= 60 ? `${Math.floor(total / 60)}m ${total % 60}s` : `${total}s`;
}

/** The timeline line for mark `ord`. */
export function markLine(mark: ReplayMark, ord: number): string {
  const label = mark.label ? ` "${clean(mark.label, LABEL_MAX)}"` : '';
  const value = mark.kind === 'vital' && mark.value !== undefined ? ` =${Math.round(mark.value)}` : '';
  return `[${clock(mark.atMs)} #${ord}] ${mark.kind} ${clean(mark.key, KEY_MAX)}${label}${value}`;
}

/** The header lines: what the visit was, before what happened in it. */
export function digestHeader(recording: DigestRecording): string[] {
  const client = [recording.deviceClass, recording.browser, recording.os].filter(Boolean).join(' / ');
  const lines = [
    `visit: ${clean(client, KEY_MAX)} · release ${clean(recording.releaseKey || '-', 64)} · ${duration(recording.durationMs)}`,
    `path: ${clean(recording.entryPath || '/', KEY_MAX)} → ${clean(recording.exitPath || recording.entryPath || '/', KEY_MAX)}`,
  ];
  const tags = Object.entries(recording.tags).slice(0, TAGS_MAX).map(([k, v]) => `${clean(k, 40)}=${clean(v, 40)}`);
  if (tags.length) lines.push(`tags: ${tags.join(', ')}`);
  return lines;
}

/** The whole digest, header first, at most {@link DIGEST_MAX_LINES} lines. */
export function visitDigest(recording: DigestRecording, marks: readonly ReplayMark[]): string {
  const header = digestHeader(recording);
  const room = Math.max(0, DIGEST_MAX_LINES - header.length);
  const lines = marks.slice(0, room).map((mark, ord) => markLine(mark, ord));
  return [...header, ...lines].join('\n');
}

/** One line for a list ("search recordings" answers): who, how long, where, what went wrong. */
export function oneLineDigest(recording: DigestRecording & {
  pageCount?: number;
  counts?: { rage: number; dead: number; errors: number };
  converted?: boolean;
}): string {
  const issues = recording.counts
    ? [
      recording.counts.rage ? `${recording.counts.rage} rage` : '',
      recording.counts.dead ? `${recording.counts.dead} dead` : '',
      recording.counts.errors ? `${recording.counts.errors} errors` : '',
    ].filter(Boolean).join(', ')
    : '';
  return [
    `${recording.deviceClass} ${duration(recording.durationMs)}`,
    `${clean(recording.entryPath || '/', 60)} → ${clean(recording.exitPath || '/', 60)}`,
    recording.pageCount !== undefined ? `${recording.pageCount} pages` : '',
    issues,
    recording.converted ? 'converted' : '',
  ].filter(Boolean).join(' · ');
}
