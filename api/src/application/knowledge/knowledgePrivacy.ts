/**
 * knowledgePrivacy — the ONE place the knowledge graph's privacy bound is stated (PRD 38 §5.2):
 * the platform stores a model's JUDGEMENT about a source, never the source. A claim may quote
 * at most {@link MAX_QUOTE_LINES} lines and an extracted node's label is one line, so a host
 * that sends a whole file body as a "claim" cannot park it in project memory or R2.
 *
 * `MAX_QUOTE_LINES` mirrors the constant of the same name in builderforce-memory's judge
 * (not exported from the package, hence stated here once for the application layer).
 */
import type { Extracted } from '@seanhogg/builderforce-memory/knowledge';

export const MAX_QUOTE_LINES = 3;
/** Characters a single-line node label keeps. */
export const MAX_LABEL_CHARS = 200;

/** The first {@link MAX_QUOTE_LINES} non-blank lines of `content`. */
export function clampQuoteLines(content: string): string {
  const lines = content.split(/\r?\n/);
  if (lines.length <= MAX_QUOTE_LINES) return content;
  return lines.filter((l) => l.trim() !== '').slice(0, MAX_QUOTE_LINES).join('\n');
}

/** A label is one line: the first non-blank line, bounded. */
export function clampLabel(label: string): string {
  const first = label.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  return first.trim().slice(0, MAX_LABEL_CHARS);
}

/** Extracted output with every node label reduced to one line. */
export function clampExtracted(extracted: readonly Extracted[]): Extracted[] {
  return extracted.map((e) => ({ ...e, nodes: e.nodes.map((n) => ({ ...n, label: clampLabel(n.label) })) }));
}
