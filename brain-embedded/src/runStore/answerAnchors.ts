/**
 * The files a run's answer was ABOUT — the anchors a cached answer is stored with, so
 * the server can drop it once one of them changes (`projectMemory` staleness; the
 * server stamps each path's content hash from its directory index when the client has
 * none). Without them a chat answer cached the Q&A pair unanchored, and "how does
 * auth.ts work?" replayed for a week after auth.ts was rewritten.
 *
 * Source: the run's own trace — every file it successfully READ this run. Pure.
 */

import type { BrainTraceEvent } from '../brainTriage';
import type { AnswerFileAnchor } from '../evermindMemory';

/** Tools whose successful call returned a file's content. */
const FILE_READ_TOOLS: ReadonlySet<string> = new Set(['read_file', 'view_file', 'open_file', 'read_files']);
/** Argument keys that name the file read. */
const PATH_KEYS = ['path', 'file', 'filePath'] as const;
/** Anchors stored per answer — enough to cover a focused answer, bounded for the row. */
export const MAX_ANSWER_ANCHORS = 16;

function normalizePath(p: string): string {
  return p.trim().split('\\').join('/').replace(/^\.\/+/, '');
}

/** The distinct files this run read, oldest first, as path-only anchors. */
export function readFileAnchors(trace: readonly BrainTraceEvent[]): AnswerFileAnchor[] {
  const seen = new Set<string>();
  const out: AnswerFileAnchor[] = [];
  for (const ev of trace) {
    if (ev.category !== 'tool' || ev.isError || !FILE_READ_TOOLS.has(ev.label)) continue;
    const args = (ev.args ?? {}) as Record<string, unknown>;
    const paths = Array.isArray(args.paths) ? args.paths : PATH_KEYS.map((k) => args[k]);
    for (const raw of paths) {
      if (typeof raw !== 'string') continue;
      const path = normalizePath(raw);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      out.push({ path });
      if (out.length >= MAX_ANSWER_ANCHORS) return out;
    }
  }
  return out;
}
