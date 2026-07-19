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

/** A filename-safe stem derived from the chat title (or a fallback). */
export function exportFilenameStem(title: string, fallback: string): string {
  const stem = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return stem || fallback;
}
