/**
 * Did this run's change actually SHIP?
 *
 * `tickets.from_delta` opens its ticket in the `in_review` lane, and its own tool
 * description promises the ticket "completes automatically once merged and
 * deployed". That completion never happened: nothing in the codebase moves a delta
 * ticket out of `in_review`. So every ad-hoc change an agent recorded left a ticket
 * pinned at 50% on the board, forever, with no actor and no event that could ever
 * finish it — the board slowly filling with half-done work that was in fact done.
 *
 * The intended completer was a GitHub merge webhook, which only fires for a change
 * that went through a pull request. It cannot fire for the case this module covers:
 * the agent committed and pushed straight to the base branch, in the same run. There
 * the run has first-hand evidence the work shipped, and is the only thing that will
 * ever have it.
 *
 * The evidence has to be strong, because completing a ticket that did NOT ship is a
 * worse failure than leaving one open. Two independent facts are required:
 *
 *  1. A `git push` actually SUCCEEDED in this run.
 *  2. A git status observed AFTER that push shows the working branch is a BASE
 *     branch, tracking an upstream, with nothing left to push.
 *
 * A push to a feature branch fails (2) on the branch name; an unpushed commit fails
 * it on `ahead`; a run that only edited files fails (1). Every ambiguous case fails
 * closed and leaves the ticket alone.
 *
 * Pure over the recorded trace — no clock, no shell, no I/O.
 */

import { isFailedToolResult, type BrainTraceEvent } from './brainTriage';

/**
 * Branches whose content is, by definition, shipped. Deliberately just the two
 * conventional defaults: a repo whose base branch is named something else simply
 * does not auto-complete, which is the safe direction to be wrong in.
 */
export const BASE_BRANCHES: ReadonlySet<string> = new Set(['main', 'master']);

export interface GitShortStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

/**
 * Parse the branch header of `git status --short --branch`.
 *
 * The first line is `## <branch>...<upstream> [ahead N, behind M]`, or `## <branch>`
 * with no upstream, or `## HEAD (no branch)` when detached. Returns null when no
 * such header is present, so a caller can never mistake "could not tell" for
 * "clean and pushed".
 */
export function parseGitShortStatus(output: string): GitShortStatus | null {
  if (!output) return null;
  const header = output.split('\n').map((l) => l.trim()).find((l) => l.startsWith('##'));
  if (!header) return null;

  const body = header.slice(2).trim();
  if (!body || body.startsWith('HEAD (no branch)')) return { branch: null, upstream: null, ahead: 0, behind: 0 };

  // `[ahead 2, behind 1]` — absent entirely when the branch is level.
  const ahead = /\bahead (\d+)/.exec(body);
  const behind = /\bbehind (\d+)/.exec(body);
  const names = body.replace(/\s*\[.*$/, '').trim();
  const [branch, upstream] = names.split('...');

  return {
    branch: branch?.trim() || null,
    upstream: upstream?.trim() || null,
    ahead: ahead ? Number(ahead[1]) : 0,
    behind: behind ? Number(behind[1]) : 0,
  };
}

/** A push has landed when a successful shell step ran `git push`. */
const GIT_PUSH = /\bgit\s+(?:-\S+\s+|--\S+(?:=\S+)?\s+)*push\b/i;
/** A status observation, whether from the tool or from a raw shell call. */
const GIT_STATUS_CMD = /\bgit\s+(?:-\S+\s+|--\S+(?:=\S+)?\s+)*status\b/i;

/** The shell command a step ran, from either `{ command }` or `{ cmd }` args. */
function commandOf(ev: BrainTraceEvent): string {
  const a = ev.args as { command?: unknown; cmd?: unknown } | undefined;
  if (typeof a?.command === 'string') return a.command;
  if (typeof a?.cmd === 'string') return a.cmd;
  return '';
}

/** The textual output a step returned, from `{ output }` / `{ stdout }` / a string. */
function outputOf(ev: BrainTraceEvent): string {
  const r = ev.result;
  if (typeof r === 'string') return r;
  if (r && typeof r === 'object') {
    const o = r as { output?: unknown; stdout?: unknown };
    if (typeof o.output === 'string') return o.output;
    if (typeof o.stdout === 'string') return o.stdout;
  }
  return '';
}

function succeeded(ev: BrainTraceEvent): boolean {
  return !ev.isError && !isFailedToolResult(ev.result);
}

/**
 * Did this run push its work to a base branch and verify it landed?
 *
 * Requires a successful push, and then a status — recorded AFTER it — showing a base
 * branch, an upstream, and nothing left to push. Order matters: a status taken
 * BEFORE the push says nothing about whether the push worked.
 */
export function shippedToBaseBranch(events: BrainTraceEvent[]): boolean {
  const steps = events.filter((e) => e.category === 'tool');

  let pushedAt = -1;
  for (let i = 0; i < steps.length; i += 1) {
    if (succeeded(steps[i]) && GIT_PUSH.test(commandOf(steps[i]))) pushedAt = i;
  }
  if (pushedAt < 0) return false;

  for (let i = pushedAt + 1; i < steps.length; i += 1) {
    const ev = steps[i];
    if (!succeeded(ev)) continue;
    const isStatus = ev.label === 'git_status' || GIT_STATUS_CMD.test(commandOf(ev));
    if (!isStatus) continue;
    const status = parseGitShortStatus(outputOf(ev));
    if (!status) continue;
    if (status.branch && BASE_BRANCHES.has(status.branch) && status.upstream && status.ahead === 0) return true;
  }
  return false;
}
