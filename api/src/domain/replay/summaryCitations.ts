/**
 * Cited AI text, enforced (PRD 33 D13: "uncited sentences are dropped") — pure.
 *
 * A recording summary must end every sentence with `#<ord>`, the timeline index of
 * the mark it describes; a segment summary cites `<recordingId>#<ord>`. These
 * parsers KEEP only text whose citation names something that exists, so a model
 * cannot assert a moment that is not on the timeline.
 */

/** Split prose into sentences (a sentence ends at . ! ? followed by space or end). */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=\S)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A sentence's trailing citation(s): `… #12.`, `… (#12)`, `… #3 #4.` → [12] / [3, 4]. */
const TRAILING_CITES = /((?:\s*\(?#\d{1,4}\)?[,;]?)+)\s*[.!?]?\s*$/;

function trailingOrds(sentence: string): number[] {
  const tail = TRAILING_CITES.exec(sentence);
  if (!tail) return [];
  return [...tail[1]!.matchAll(/#(\d{1,4})/g)].map((m) => Number(m[1]));
}

export interface CitedSummary {
  summary: string;
  /** Distinct cited ords, in the order first cited. */
  ords: number[];
}

/**
 * Keep the sentences that END with at least one citation of an existing ord; drop
 * the rest. A sentence citing several ords is kept when any is valid, and only the
 * valid ones are recorded.
 */
export function parseCitations(text: string, ordCount: number): CitedSummary {
  const kept: string[] = [];
  const ords: number[] = [];
  for (const sentence of splitSentences(text)) {
    const valid = trailingOrds(sentence).filter((ord) => Number.isInteger(ord) && ord >= 0 && ord < ordCount);
    if (valid.length === 0) continue;
    kept.push(sentence);
    for (const ord of valid) if (!ords.includes(ord)) ords.push(ord);
  }
  return { summary: kept.join(' '), ords };
}

export interface SegmentPattern {
  text: string;
  examples: Array<{ recordingId: string; ord: number }>;
}

const RECORDING_CITE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})#(\d{1,4})/gi;

/**
 * One pattern per non-empty line, each citing `recordingId#ord`. A line keeps only
 * the citations of sampled recordings whose timeline has that ord; a line left
 * with none is dropped. The citations are stripped from the visible text.
 */
export function parsePatternCitations(
  text: string,
  ordCounts: ReadonlyMap<string, number>,
  max = 3,
): SegmentPattern[] {
  const patterns: SegmentPattern[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (patterns.length >= max) break;
    const line = rawLine.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
    if (!line) continue;
    const examples: SegmentPattern['examples'] = [];
    for (const match of line.matchAll(RECORDING_CITE)) {
      const recordingId = match[1]!.toLowerCase();
      const ord = Number(match[2]);
      const count = ordCounts.get(recordingId);
      if (count !== undefined && ord < count && !examples.some((e) => e.recordingId === recordingId && e.ord === ord)) {
        examples.push({ recordingId, ord });
      }
    }
    if (examples.length === 0) continue;
    const visible = line
      .replace(RECORDING_CITE, '')
      .replace(/[[(]\s*[,;\s]*[\])]/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.,;:!?])/g, '$1')
      .trim();
    if (visible) patterns.push({ text: visible, examples });
  }
  return patterns;
}
