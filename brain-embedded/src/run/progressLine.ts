/**
 * The host-derived progress line (PRD 45 §4.7 B5) — one deterministic line per turn,
 * a pure function of the run's OWN trace (`RunCell.trace` slice for this run):
 *
 *     3 files changed · 2 checked · push needs: test for inbound.ts
 *
 * It is computed by the HOST from recorded tool calls (edit_file/write_file changes,
 * check/diagnostic runs such as a typecheck or a targeted test) — never from model
 * prose, so it needs zero model cooperation and cannot be talked out of existence.
 * No new tool is added and `update_task_state` stays off: the trace the loop already
 * records is the only input.
 */

import { isTestPath } from '@builderforce/run-guards';

/** The trace-event slice this module reads — structural, so no runtime import of the
 *  triage module (and its dependency graph) is needed; `BrainTraceEvent` satisfies it. */
export interface ProgressTraceEvent {
  category: string;
  label: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
}

/** Tool calls that change a file on disk (create/edit/delete), by call name. */
const WRITE_TOOL_KINDS = new Map<string, 'create' | 'edit' | 'delete'>([
  ['write_file', 'create'],
  ['write', 'create'],
  ['create', 'create'],
  ['edit_file', 'edit'],
  ['edit', 'edit'],
  ['apply_patch', 'edit'],
  ['delete_file', 'delete'],
  ['delete', 'delete'],
]);

/** A file path recorded in a tool call's arguments (or the only path of a batch edit). */
function pathOf(args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const direct = (args as { path?: unknown }).path;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const edits = (args as { edits?: unknown }).edits;
  if (Array.isArray(edits)) {
    for (const e of edits) {
      const p = (e as { path?: unknown } | null)?.path;
      if (typeof p === 'string' && p.trim()) return p.trim();
    }
  }
  return undefined;
}

function isCheckCall(label: string, args: unknown): boolean {
  // The label alone is often just `run_command` — the check kind lives in the args (the command).
  return /tsc|typecheck|type-check|vitest|jest|mocha|\.test\.|\.spec\.|\btest\b|\btests\b|lint/i.test(`${label} ${JSON.stringify(args ?? {})}`);
}

/** Whole-tree check whose result speaks for every file (e.g. `npx tsc --noEmit`). */
function isGlobalTypecheck(label: string, args: unknown): boolean {
  const text = `${label} ${JSON.stringify(args ?? {})}`.toLowerCase();
  if (!/tsc|typecheck|type-check/.test(text)) return false;
  return !/\b(grep|vitest|jest|mocha|test|spec)\b/.test(text);
}

function isTestRunCall(label: string, args: unknown): boolean {
  const text = `${label} ${JSON.stringify(args ?? {})}`;
  return /vitest|jest|mocha|\.test\.|\.spec\.|\btest\b|\btests\b/i.test(text) && !/tsc|typecheck|type-check/i.test(text);
}

/** The basename without extension — what a check's output mentions for a file. */
function baseOf(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function mentionText(ev: ProgressTraceEvent): string {
  return `${ev.label} ${JSON.stringify(ev.args ?? {})} ${typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result ?? {})}`;
}

/** The deterministic progress line for this run's trace so far, or '' when nothing changed. */
export function computeProgressLine(trace: readonly ProgressTraceEvent[]): string {
  interface FileState {
    path: string;
    kind: 'create' | 'edit' | 'delete';
    at: number;
  }
  const files = new Map<string, FileState>();
  interface CheckCall { at: number; text: string; typecheck: boolean; globalTypecheck: boolean; testRun: boolean }
  const checkCalls: CheckCall[] = [];

  trace.forEach((ev, step) => {
    if (ev.category === 'tool') {
      const kind = WRITE_TOOL_KINDS.get(ev.label);
      if (kind) {
        if (ev.isError) return; // a failed call never changed anything
        const path = pathOf(ev.args);
        if (path) files.set(path, { path, kind, at: step });
        return;
      }
      if (!ev.isError && isCheckCall(ev.label, ev.args)) {
        const text = mentionText(ev);
        const typecheck = /tsc|typecheck|type-check/i.test(`${ev.label} ${JSON.stringify(ev.args ?? {})}`);
        checkCalls.push({ at: step, text, typecheck, globalTypecheck: isGlobalTypecheck(ev.label, ev.args), testRun: isTestRunCall(ev.label, ev.args) });
      }
      return;
    }
    // The recorded check-result note a host attaches to an edit/write result.
    if (ev.category === 'message' && /diagnostics/i.test(ev.label) && ev.args && typeof ev.args === 'object') {
      const a = ev.args as { path?: unknown };
      if (typeof a.path === 'string' && a.path.trim()) {
        const text = mentionText(ev);
        checkCalls.push({ at: step, text, typecheck: /tsc|typecheck|type-check/i.test(text), globalTypecheck: false, testRun: false });
      }
    }
  });

  // A delete settles the file: it is no longer a pending change.
  for (const [path, st] of files) if (st.kind === 'delete') files.delete(path);
  const changed = [...files.values()];
  if (changed.length === 0) return '';

  /** Check calls that ran at or after the file's latest change — an earlier check
   *  spoke for older bytes, not the current ones. */
  const checksFor = (st: FileState) => checkCalls.filter((c) => c.at >= st.at);
  const mentions = (c: CheckCall, st: FileState): boolean => c.text.includes(st.path) || c.text.includes(baseOf(st.path));
  /** The file carries its own check/diagnostic evidence: a check call that names it. */
  const isChecked = (st: FileState): boolean => checksFor(st).some((c) => mentions(c, st));
  /** The push gate's typecheck requirement: a whole-tree typecheck, or a typecheck
   *  call that named the file. A test run is not a typecheck. */
  const hasTypecheck = (st: FileState): boolean => checksFor(st).some((c) => c.globalTypecheck || (c.typecheck && mentions(c, st)));
  const hasTestRunMention = (st: FileState): boolean => checksFor(st).some((c) => c.testRun && mentions(c, st));

  // What the push gate still needs (PRD §5): a NEW source file with no test, and any
  // changed file not yet covered by a check/typecheck. Test needs first, then
  // typecheck, each in path order — one deterministic ordering.
  const isSourceLike = (p: string) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|rs|go|java|rb|php|cs|cpp|c|h|hpp|swift|kt|swift)$/i.test(p);
  const typecheckNeeds: string[] = [];
  const testNeeds: string[] = [];
  for (const st of [...changed].sort((a, b) => a.path.localeCompare(b.path))) {
    if (!hasTypecheck(st)) typecheckNeeds.push(`${st.path} not typechecked`);
    if (st.kind === 'create' && isSourceLike(st.path) && !isTestPath(st.path) && !hasTestRunMention(st)) {
      testNeeds.push(`test for ${st.path.split(/[\\/]/).pop()}`);
    }
  }

  const checked = changed.filter(isChecked).length;
  const base = `${changed.length} files changed · ${checked} checked`;
  const needs = [...testNeeds, ...typecheckNeeds];
  return needs.length === 0 ? base : `${base} · push needs: ${needs.join('; ')}`;
}
