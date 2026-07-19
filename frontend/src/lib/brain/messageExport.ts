/**
 * Lift exportable data out of a Brain reply.
 *
 * The Document and Slides capabilities export server-side (the OOXML writers live
 * in the API), but a Spreadsheet / Data Visualization reply already contains its
 * rows — either as the ```csv fence the capability prompt asks for, or as the GFM
 * table it renders. Reading them here keeps that export a pure client save with
 * no round-trip.
 */

import { toCsv } from '@/lib/download';
import { getBrainCapability } from './capabilities';

const CSV_FENCE = /```csv\s*\n([\s\S]*?)```/i;
const TABLE_DIVIDER = /^\|?[\s:|-]+\|[\s:|-]*$/;

function splitRow(line: string): string[] {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

/**
 * The reply's tabular data as CSV: the ```csv fence when present, otherwise the
 * first markdown table converted. Null when the reply has neither.
 */
export function extractCsv(markdown: string): string | null {
  const fenced = CSV_FENCE.exec(markdown);
  if (fenced?.[1]?.trim()) return fenced[1].trim();

  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i] ?? '';
    const next = lines[i + 1] ?? '';
    if (!line.includes('|') || !next.includes('|') || !TABLE_DIVIDER.test(next)) continue;
    const head = splitRow(line);
    const rows: string[][] = [];
    for (let j = i + 2; j < lines.length; j++) {
      const row = lines[j] ?? '';
      if (!row.includes('|') || !row.trim()) break;
      rows.push(splitRow(row));
    }
    return toCsv(head, rows);
  }
  return null;
}

const HAS_TABLE = /^\s*\|.*\|\s*$[\r\n]+^\s*\|?[\s:|-]+\|/m;
const HAS_FENCE = /```[\w./+-]*\s*\n[\s\S]*?\n?```/;
const HAS_MERMAID = /```mermaid\s*\n[\s\S]*?```/;
const HAS_SLIDE_HEADING = /^##\s+\S/m;
const HAS_HEADING = /^#{1,3}\s+\S/m;

/**
 * Did this reply actually DELIVER the capability's artifact?
 *
 * A weak model will answer a chart request with a title line and nothing else
 * ("Project tasks status distribution:"), which renders as a near-empty bubble —
 * the user clicks a capability, gets a stub, and has no idea what went wrong.
 * The consumer uses this to say so and offer a retry.
 *
 * Conservative by design: it answers "is the expected SHAPE present", never
 * "is the content good". No capability, or a reply that is still streaming,
 * means no verdict — callers should skip the check.
 */
export function replyHasArtifact(capability: string | null | undefined, content: string): boolean {
  const expects = getBrainCapability(capability)?.expects;
  if (!expects) return true;
  const text = content.trim();
  if (!text) return false;

  switch (expects) {
    case 'chart':
      // A chart, or at minimum the figures behind one.
      return HAS_MERMAID.test(text) || HAS_TABLE.test(text) || extractCsv(text) != null;
    case 'table':
      return HAS_TABLE.test(text) || extractCsv(text) != null;
    case 'slides':
      return HAS_SLIDE_HEADING.test(text);
    case 'code':
      return HAS_FENCE.test(text);
    case 'document':
      // A document is prose, so the only honest floor is "more than a stub":
      // a heading with body under it, or a few real sentences.
      return HAS_HEADING.test(text) ? text.length > 200 : text.length > 400;
    default:
      return true;
  }
}

/** A filename-safe stem derived from the chat title (or a fallback). */
export function exportFilenameStem(title: string, fallback: string): string {
  const stem = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return stem || fallback;
}
