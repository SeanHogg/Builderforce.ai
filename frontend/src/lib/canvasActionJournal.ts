/**
 * What the person was actually DOING — the thing every canvas diagnostics report
 * so far has been missing.
 *
 * THE REPORT THAT PROVED IT. A user dropped several files on a board, one of
 * them an HTML guide, then asked the Brain to review it. The Brain said the file
 * was not on the canvas. The diagnostics report they sent to explain it said:
 *
 *     objects: 4
 *     objectKinds: chat:1, code:1, slides:1, workflow:1
 *     scope: selection
 *
 * Every fact true, and not one of them the fact that mattered. Nothing recorded
 * that four files had been dropped, that one of them became a `code` object
 * rather than a document, how long the turn took, which tools it called, or that
 * the turn ran against a SELECTION rather than the board. A report that can only
 * describe the end state cannot explain how the state got there — so it agrees
 * with whatever the screen is already showing, which is exactly when a person
 * reaches for diagnostics.
 *
 * So the canvas keeps a journal: an ordered, bounded record of the actions the
 * person and the agent took, each with a duration and an outcome. Pure and
 * framework-free, so the capture points are one function call and the report is
 * unit-testable without a canvas.
 */

/** The kind of thing that happened. Kept coarse: a taxonomy nobody can remember
 *  gets used inconsistently, and an inconsistent journal is worse than none. */
export type CanvasActionKind =
  /** The person did something directly: dropped a file, added or deleted an
   *  object, changed the scope, ran something. */
  | 'user'
  /** A Brain turn, start to finish. */
  | 'turn'
  /** One tool/MCP call made during a turn. */
  | 'tool'
  /** A network round trip the canvas made on its own (save, load, presence). */
  | 'io'
  /** Something the product did that the person did not ask for and should know
   *  about — a file downgraded to an attachment, a truncation, a rejected save. */
  | 'notice';

export interface CanvasAction {
  /** Monotonic within a session; makes ordering stable when timestamps collide. */
  seq: number;
  at: string;
  kind: CanvasActionKind;
  /** Short, stable label: `file.import`, `object.add`, `brain.turn`, `canvas_add_object`. */
  label: string;
  /** How long it took, when the action had a duration. */
  durationMs?: number;
  ok?: boolean;
  /** One line of specifics — a file name, an object kind, an error message. */
  detail?: string;
}

/** Bounded so a long session cannot grow the journal without limit; the tail is
 *  what explains a failure, so the OLDEST entries are the ones dropped. */
export const JOURNAL_LIMIT = 240;

export interface CanvasJournal {
  record: (entry: Omit<CanvasAction, 'seq' | 'at'> & { at?: string }) => void;
  /**
   * Record an action that takes time. Returns a `done` callback so the caller
   * writes the START immediately (a turn that never finishes still appears —
   * which is the case a report most needs to show) and stamps the duration on
   * completion.
   */
  begin: (kind: CanvasActionKind, label: string, detail?: string) => (result?: { ok?: boolean; detail?: string }) => void;
  entries: () => CanvasAction[];
  clear: () => void;
}

/**
 * Create a journal.
 *
 * `now` is injected so the tests are not timing-dependent, and so the whole
 * module stays free of `Date.now()` at module scope.
 */
export function createCanvasJournal(now: () => number = () => Date.now()): CanvasJournal {
  let seq = 0;
  let entries: CanvasAction[] = [];

  const push = (entry: CanvasAction) => {
    entries.push(entry);
    if (entries.length > JOURNAL_LIMIT) entries = entries.slice(entries.length - JOURNAL_LIMIT);
  };

  const record: CanvasJournal['record'] = (entry) => {
    seq += 1;
    // `record` is for an event that has already happened. Leaving its duration
    // undefined makes diagnostics indistinguishable from an action opened with
    // `begin` that genuinely never settled. In particular, completed Brain tool
    // trace events arrive here only after their result exists, yet reports called
    // every one of them "never completed". Timed work must use `begin`; an
    // instantaneous completed event is explicitly zero milliseconds.
    push({ durationMs: 0, ...entry, seq, at: entry.at ?? new Date(now()).toISOString() });
  };

  const begin: CanvasJournal['begin'] = (kind, label, detail) => {
    const startedAt = now();
    seq += 1;
    const started: CanvasAction = { seq, at: new Date(startedAt).toISOString(), kind, label, ...(detail ? { detail } : {}) };
    push(started);
    let settled = false;
    return (result) => {
      // Guard the double-settle: a turn that both resolves and errors would
      // otherwise write two durations for one action and inflate every average.
      if (settled) return;
      settled = true;
      started.durationMs = Math.max(0, Math.round(now() - startedAt));
      if (result?.ok != null) started.ok = result.ok;
      if (result?.detail) started.detail = started.detail ? `${started.detail} · ${result.detail}` : result.detail;
    };
  };

  return { record, begin, entries: () => [...entries], clear: () => { entries = []; seq = 0; } };
}

interface GraphShape {
  nodes: Array<{ id: string; data?: { kind?: unknown; title?: unknown } }>;
  edges: Array<{ id: string }>;
}

/**
 * What changed between two board states, in the words a person would use.
 *
 * Derived from the graph rather than reported by each handler ON PURPOSE. A
 * board is mutated from a dozen places — the palette, a drag, a delete key, the
 * inspector, an AI proposal, an undo — and instrumenting each one means the next
 * mutation path added is the one that silently is not tracked. The board's own
 * history checkpoint is the single place they all arrive, so recording there
 * covers every path that exists and every path anyone adds later.
 *
 * Returns null when nothing material changed, so a re-render never writes a row.
 */
export function describeGraphChange(before: GraphShape, after: GraphShape): { label: string; detail: string } | null {
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]));
  const afterNodes = new Map(after.nodes.map((node) => [node.id, node]));
  const added = after.nodes.filter((node) => !beforeNodes.has(node.id));
  const removed = before.nodes.filter((node) => !afterNodes.has(node.id));
  const edgeDelta = after.edges.length - before.edges.length;

  const kindOf = (node: { data?: { kind?: unknown } }) => (typeof node.data?.kind === 'string' ? node.data.kind : 'object');
  const nameOf = (node: { data?: { title?: unknown } }) => (typeof node.data?.title === 'string' && node.data.title ? node.data.title : '(untitled)');

  if (added.length) {
    return {
      label: 'object.add',
      detail: added.map((node) => `${kindOf(node)} "${nameOf(node)}"`).slice(0, 4).join(', ')
        + (added.length > 4 ? ` +${added.length - 4} more` : ''),
    };
  }
  if (removed.length) {
    return {
      label: 'object.delete',
      detail: removed.map((node) => `${kindOf(node)} "${nameOf(node)}"`).slice(0, 4).join(', ')
        + (removed.length > 4 ? ` +${removed.length - 4} more` : ''),
    };
  }
  if (edgeDelta !== 0) {
    return { label: edgeDelta > 0 ? 'connection.add' : 'connection.delete', detail: `${Math.abs(edgeDelta)} connection(s)` };
  }

  // Same objects, same connections — so a field changed. Naming WHICH object was
  // edited is what separates "the board changed" from "the board changed and it
  // was the workflow", and the second is the one that explains a bug report.
  const edited = after.nodes.filter((node) => {
    const prior = beforeNodes.get(node.id);
    return prior != null && JSON.stringify(prior.data ?? {}) !== JSON.stringify(node.data ?? {});
  });
  if (edited.length) {
    return {
      label: 'object.edit',
      detail: edited.map((node) => `${kindOf(node)} "${nameOf(node)}"`).slice(0, 3).join(', ')
        + (edited.length > 3 ? ` +${edited.length - 3} more` : ''),
    };
  }
  // Position-only moves land here: the graph differs but nothing above matched.
  return null;
}

export interface CanvasTimings {
  label: string;
  count: number;
  /** Actions that started and never finished — the shape of a hang. */
  pending: number;
  failed: number;
  p50Ms: number | null;
  maxMs: number | null;
}

/**
 * Roll the journal up by label.
 *
 * p50 rather than a mean: one 40-second cold start would drag a mean far enough
 * to hide that every other call was fast, and "which call is slow" is the only
 * question this table exists to answer.
 */
export function summarizeTimings(actions: readonly CanvasAction[]): CanvasTimings[] {
  const byLabel = new Map<string, CanvasAction[]>();
  for (const action of actions) {
    const bucket = byLabel.get(action.label);
    if (bucket) bucket.push(action);
    else byLabel.set(action.label, [action]);
  }
  return [...byLabel.entries()]
    .map(([label, group]) => {
      const durations = group.map((action) => action.durationMs).filter((value): value is number => typeof value === 'number').sort((a, b) => a - b);
      return {
        label,
        count: group.length,
        pending: group.filter((action) => action.durationMs == null).length,
        failed: group.filter((action) => action.ok === false).length,
        p50Ms: durations.length ? durations[Math.floor((durations.length - 1) / 2)]! : null,
        maxMs: durations.length ? durations[durations.length - 1]! : null,
      };
    })
    .sort((a, b) => (b.maxMs ?? -1) - (a.maxMs ?? -1) || a.label.localeCompare(b.label));
}

/**
 * The gaps — what the journal says went wrong, stated as findings rather than
 * left for a reader to infer from a wall of rows.
 *
 * This is the section that lets the report DISAGREE with the screen: the UI has
 * no way to show "a turn ran against one object while four were on the board",
 * and that single line is what would have explained the reported failure.
 */
export function journalGaps(
  actions: readonly CanvasAction[],
  context: { objectCount: number; scope: string; scopedObjectCount: number },
): string[] {
  const gaps: string[] = [];

  const pending = actions.filter((action) => action.durationMs == null && (action.kind === 'turn' || action.kind === 'tool' || action.kind === 'io'));
  if (pending.length) {
    gaps.push(`${pending.length} action(s) started and never completed: ${[...new Set(pending.map((action) => action.label))].join(', ')}. A hang, a thrown error with no catch, or the tab was closed mid-flight.`);
  }

  const failed = actions.filter((action) => action.ok === false);
  if (failed.length) {
    gaps.push(`${failed.length} action(s) failed: ${[...new Set(failed.map((action) => action.label))].slice(0, 6).join(', ')}.`);
  }

  // The exact condition behind the reported "I don't see that file" answer.
  if (context.scope !== 'canvas' && context.scopedObjectCount < context.objectCount) {
    gaps.push(`Brain turns ran against ${context.scopedObjectCount} of ${context.objectCount} objects (scope: ${context.scope}). An answer about "what is on the canvas" from this scope is answering about a subset.`);
  }

  const imports = actions.filter((action) => action.label === 'file.import');
  const downgraded = imports.filter((action) => /attachment|unreadable|too large/i.test(action.detail ?? ''));
  if (downgraded.length) {
    gaps.push(`${downgraded.length} of ${imports.length} imported file(s) could not be read and landed as plain attachments — their contents are not available to Brain.`);
  }

  const slow = actions.filter((action) => (action.durationMs ?? 0) > 30_000);
  if (slow.length) {
    gaps.push(`${slow.length} action(s) took over 30s: ${[...new Set(slow.map((action) => action.label))].join(', ')}.`);
  }

  return gaps;
}
