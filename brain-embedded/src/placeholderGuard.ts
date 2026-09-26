/**
 * The PLACEHOLDER guard — unfinished work written into code, caught at the moment it is
 * written and named in the diagnostics.
 *
 * Measured on chat #127: asked to thread the parent run's abort signal into a delegated
 * sub-agent, the VS Code agent wrote
 *
 *     return undefined; // TODO: wire up the actual signal
 *
 * plus comments that were its own thinking left in the source ("Let me use that approach
 * instead", "A proper implementation would…"), committed it, and reported the bug FIXED.
 * Nothing in the run noticed: the edit succeeded, the tool answered `{ ok: true }`, and
 * the diagnostics counted "19 mutating calls, 19 succeeded". A stub is the one kind of
 * edit that succeeds by every measure the run had and does nothing.
 *
 * So a successful code write is scanned for NEW placeholder markers — markers the
 * replaced text did not already carry, so editing near an old TODO is not blamed on this
 * run — and two things happen: the model is told on the result it reads (the only moment
 * it can still finish the work), and a trace step records it, which the copied
 * diagnostics report as its own line.
 *
 * Only COMMENTS are scanned (plus the one code-shaped stub, `throw new Error("not
 * implemented")`): a string such as an input's `placeholder="Search"` is product copy,
 * not unfinished work. Only source files are scanned: a roadmap that lists TODO items is
 * doing its job. Pure: no I/O, no clock.
 */

import type { BrainTraceEvent } from './brainTriage';
import { isDelegationTool } from './codeChanges';

/** The trace label a detected placeholder is recorded under. */
export const PLACEHOLDER_GUARD_LABEL = 'tools.placeholder_guard';

/** One placeholder line a write introduced. */
export interface PlaceholderHit {
  path: string;
  /** The offending line, trimmed and capped. */
  text: string;
}

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|swift|cs|rb|php|sql|sh|ps1|vue|svelte)$/i;

/** Markers that, inside a comment, mean "this is not done". */
const COMMENT_MARKERS: readonly RegExp[] = [
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bXXX\b/,
  /\bfor now\b/i,
  /\b(?:a|the) (?:proper|real|full) implementation (?:would|should|will)\b/i,
  /\bnot (?:yet )?(?:implemented|wired)\b/i,
  // The model's own reasoning left in the source — it was talking to itself, not
  // documenting the code.
  /\blet me\b/i,
  /\bI'll\b/,
];

/** A stub that compiles and throws — unfinished by construction. */
const STUB_THROW = /throw new Error\(\s*["'`]\s*(?:not (?:yet )?implemented|todo)/i;

/** The comment part of one source line, or null when the line carries none. */
function commentOf(line: string): string | null {
  const t = line.trim();
  if (t.startsWith('//') || t.startsWith('#') || t.startsWith('*') || t.startsWith('/*')) return t;
  const slash = line.indexOf('//');
  // `://` is a URL, not a comment.
  if (slash > 0 && line[slash - 1] !== ':') return line.slice(slash);
  return null;
}

/** Every placeholder line in `text`, trimmed and capped — the unit a hit is compared in. */
export function markedLines(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const comment = commentOf(line);
    if ((comment && COMMENT_MARKERS.some((re) => re.test(comment))) || STUB_THROW.test(line)) {
      out.push(line.trim().slice(0, 160));
    }
  }
  return out;
}

/**
 * The placeholder lines ONE successful write introduced. `write_file` is judged on its
 * whole content; `edit_file` on what its replacement adds beyond what it replaced.
 */
export function placeholdersWritten(tool: string, args: unknown): PlaceholderHit[] {
  const a = (args ?? {}) as Record<string, unknown>;
  const path = typeof a.path === 'string' ? a.path : '';
  if (!path || !SOURCE_FILE.test(path)) return [];
  const added = tool === 'write_file' ? a.content : tool === 'edit_file' ? a.new_string : undefined;
  if (typeof added !== 'string' || !added) return [];
  const before = new Set(typeof a.old_string === 'string' ? markedLines(a.old_string) : []);
  return markedLines(added)
    .filter((text) => !before.has(text))
    .map((text) => ({ path, text }));
}

/** What the model reads on the result of a write that introduced placeholders. */
export function placeholderAdvisory(hits: readonly PlaceholderHit[]): string | null {
  if (!hits.length) return null;
  const shown = hits.slice(0, 3).map((h) => `\`${h.text}\``).join(', ');
  return `PLACEHOLDER WRITTEN in ${hits[0]!.path}: ${shown}${hits.length > 3 ? ` (+${hits.length - 3} more)` : ''}. This is unfinished work, and comments that narrate your own reasoning do not belong in the source. Finish it in this run — or, if it is genuinely blocked, say so plainly in your reply and name the blocker. Never report work that contains a placeholder as done or fixed.`;
}

/** The trace step that records it, so the copied diagnostics can name it. */
export function placeholderTraceEvent(tool: string, hits: readonly PlaceholderHit[], ts: string): BrainTraceEvent {
  return {
    ts,
    category: 'message',
    label: PLACEHOLDER_GUARD_LABEL,
    args: { tool, hits },
    result: placeholderAdvisory(hits) ?? '',
  };
}

/**
 * Every placeholder a run wrote, from its trace: the parent's own writes (recorded as
 * guard steps) and a delegated child's (echoed on the `spawn_agent` result, because the
 * child's writes never reach the parent's trace as calls of their own).
 */
export function placeholdersInTrace(events: readonly BrainTraceEvent[]): PlaceholderHit[] {
  const hits: PlaceholderHit[] = [];
  for (const ev of events) {
    if (ev.label === PLACEHOLDER_GUARD_LABEL) hits.push(...asHits((ev.args as { hits?: unknown } | undefined)?.hits));
    else if (ev.category === 'tool' && isDelegationTool(ev.label)) hits.push(...delegationPlaceholders(ev.result));
  }
  return hits;
}

/** The placeholders a delegation result says its children wrote (`placeholders` on the result). */
export function delegationPlaceholders(result: unknown): PlaceholderHit[] {
  return asHits(resultField(result, 'placeholders'));
}

function asHits(raw: unknown): PlaceholderHit[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    const hit = x as Partial<PlaceholderHit>;
    return typeof hit.path === 'string' && typeof hit.text === 'string' ? [{ path: hit.path, text: hit.text }] : [];
  });
}

function resultField(result: unknown, key: string): unknown {
  let obj = result;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj) as unknown;
    } catch {
      return undefined;
    }
  }
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined;
}

/** The diagnostics line — empty when the run wrote none. */
export function formatPlaceholderLines(hits: readonly PlaceholderHit[]): string[] {
  if (!hits.length) return [];
  const files = [...new Set(hits.map((h) => h.path))];
  const sample = hits.slice(0, 2).map((h) => `\`${h.text}\``).join(' · ');
  return [
    `Placeholders written: ${hits.length} in ${files.slice(0, 3).join(', ')}${files.length > 3 ? ` (+${files.length - 3} more)` : ''} — ${sample}. Unfinished work the run wrote into code; if its reply called this done or fixed, that claim is false. Check whether a later edit removed them before trusting the change.`,
  ];
}
