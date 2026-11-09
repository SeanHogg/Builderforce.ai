/**
 * Outline-first reads (PRD 45 §4.7 B2) — the ONE decision for when `read_file` answers a
 * first whole-file read of a large file with the file's OUTLINE plus its first
 * {@link OUTLINE_FIRST_PREFIX_LINES} lines, instead of paging the whole file at the
 * model one 2,000-line window at a time.
 *
 * The lever is data: `c10_outline_first_reads` in `@builderforce/cost-levers`, rolled out
 * at 100 (on for the VSIX). The model-visible threshold matches the Markdown outline
 * precedent (`MARKDOWN_OUTLINE_MIN_CHARS`, 16,000 chars) with a line-count clause so a
 * long generated file still answers in outline even when its lines are short.
 *
 * This is a PURE decision — it computes no outline and reads no file. The host applies
 * it where it already has both the content and the symbol extractor (the `read_file`
 * executor in `@builderforce/agent-tools`), and only when the lever is on; an outline
 * first read is what the model sees ONLY, never the transcript budget.
 */

/** A file at or over this many CHARS on a first whole-file read answers in outline. */
export const OUTLINE_FIRST_MIN_CHARS = 16_000;
/** …or at or over this many LINES, whichever the file hits first. */
export const OUTLINE_FIRST_MIN_LINES = 300;
/** The prefix the outline read carries alongside the outline — the file's head. */
export const OUTLINE_FIRST_PREFIX_LINES = 40;

export interface OutlineFirstInput {
  /** The file's size in characters. */
  sizeChars: number;
  /** The file's size in lines. */
  sizeLines: number;
  /** The call named an `offset` (a paged read wants that window, not an outline). */
  hasOffset?: boolean;
  /** The call named a `limit` (an explicit window bound overrides outline-first). */
  hasLimit?: boolean;
  /** `c10_outline_first_reads` resolved by the host. Default false = unchanged behavior. */
  leverOn?: boolean;
}

/**
 * Should this `read_file` answer outline-first? True only when the lever is on, the call
 * is a genuine FIRST read (no `offset`/`limit`), and the file is at or over EITHER
 * threshold. A paged read, an explicit window, or a small file always reads normally.
 */
export function shouldOutlineFirst(input: OutlineFirstInput): boolean {
  if (input.leverOn !== true) return false;
  if (input.hasOffset === true || input.hasLimit === true) return false;
  return input.sizeChars >= OUTLINE_FIRST_MIN_CHARS || input.sizeLines >= OUTLINE_FIRST_MIN_LINES;
}

/**
 * The "how to request the rest" sentence the outline read attaches, naming the concrete
 * offset that continues past the {@link OUTLINE_FIRST_PREFIX_LINES}-line prefix.
 */
export function outlineFirstContinuationNote(totalLines: number): string {
  const next = OUTLINE_FIRST_PREFIX_LINES + 1;
  return (
    `This file is larger than one read: \`outline\` lists its definitions with line numbers, and ` +
    `the first ${Math.min(OUTLINE_FIRST_PREFIX_LINES, totalLines)} lines follow. To read a specific ` +
    `span, call read_file again with \`offset\` (1-based line) and a small \`limit\` — e.g. ` +
    `\`offset ${next}\` continues right after this prefix.`
  );
}
