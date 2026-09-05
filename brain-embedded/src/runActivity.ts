/**
 * What the run is doing RIGHT NOW — the live activity value.
 *
 * The trace records steps once they have COMPLETED, which is exactly the wrong
 * moment for a progress indicator: a `search_code` that takes 67 seconds emits
 * nothing at all until it is over, so the user sits in front of a static
 * "Thinking…" line for a minute with no way to tell a working agent from a hung
 * one. This module is the other half — the in-flight phase, published as it is
 * entered and cleared when the run ends, so a surface can render the CURRENT
 * step (which tool, on what, for how long) instead of only the settled past.
 *
 * Pure data + pure derivation: no React, no DOM, no clock of its own (callers
 * pass `startedAt`), so the web app, the VS Code webview and any future surface
 * render the same activity from the same value.
 */

/**
 * The phase a run is in. Ordered roughly as a turn moves through them, though a
 * run loops back to `thinking` for every iteration of the agent loop.
 *
 * - `starting`  — the run was accepted; the first completion hasn't opened yet.
 * - `thinking`  — a completion is open and no token has arrived (this is the
 *                 phase that used to look identical to a hang).
 * - `writing`   — tokens are streaming; the reply is visibly forming.
 * - `tool`      — a tool call is executing. Carries which one and on what.
 * - `awaiting`  — paused on a human-in-the-loop confirm; the loop cannot advance
 *                 until the user answers, so this must NOT read as "busy".
 * - `finishing` — the answer is delivered and the run is doing its post-run work
 *                 (minting the ticket for a code change, advancing linked tickets).
 *                 Real calls that take real time, and previously showed nothing.
 */
export type BrainRunPhase = 'starting' | 'thinking' | 'writing' | 'tool' | 'awaiting' | 'finishing';

/** A live, in-flight step. `null` on the snapshot means the run is idle. */
export interface BrainRunActivity {
  phase: BrainRunPhase;
  /** The tool being executed (`tool` / `awaiting` phases only). */
  label?: string;
  /**
   * The concrete THING being worked on, derived from the call's arguments — a
   * file path, a search query, a record id. "Reading LandingCanvasHero.module.css"
   * tells a user the agent is making progress; "Running a tool" does not.
   */
  detail?: string;
  /** Epoch ms when this phase began. The renderer ticks its own elapsed clock off it. */
  startedAt: number;
  /** 1-based agent-loop iteration, so a long run shows it is still advancing. */
  step: number;
}

/**
 * Argument keys that name the target of a call, in priority order. A tool's
 * arguments are free-form, so this is a heuristic — but a deliberately narrow
 * one: every key here is a *target* of the work, never an option or a flag, so
 * a wrong guess is impossible rather than merely unlikely.
 */
const TARGET_KEYS = ['path', 'file', 'filePath', 'glob', 'query', 'q', 'search', 'url', 'name', 'title', 'id'] as const;

/** Longest target we will show inline before eliding the middle. */
const MAX_DETAIL = 72;

/**
 * Shorten a target for a one-line indicator. A path elides from the LEFT (the
 * basename is what identifies it); anything else elides from the right.
 */
export function shortenTarget(value: string, max = MAX_DETAIL): string {
  const v = value.replace(/\s+/g, ' ').trim();
  if (v.length <= max) return v;
  if (v.includes('/') || v.includes('\\')) return `…${v.slice(v.length - (max - 1))}`;
  return `${v.slice(0, max - 1)}…`;
}

/**
 * Derive the human "on what" for a live tool step from its arguments. Returns
 * undefined when the call has no recognizable target — the indicator then names
 * the tool alone rather than inventing a subject for it.
 */
export function activityTarget(args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const record = args as Record<string, unknown>;
  for (const key of TARGET_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return shortenTarget(value);
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

/** Build the live activity for a tool step about to execute. */
export function toolActivity(label: string, args: unknown, step: number, startedAt: number): BrainRunActivity {
  const detail = activityTarget(args);
  return { phase: 'tool', label, startedAt, step, ...(detail ? { detail } : {}) };
}
