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

/**
 * A raw shell `git <verb>`, however git's own options precede the verb. The options
 * that TAKE A VALUE (`-C <path>`, `-c <key=value>`) are matched as a pair: a
 * multi-checkout workspace runs `git -C Builderforce.ai push`, and a pattern that only
 * skipped single-token flags stopped at the path and never saw the verb.
 */
export function gitCommandPattern(verbs: string): RegExp {
  return new RegExp(`\\bgit\\s+(?:-[Cc]\\s+\\S+\\s+|-\\S+\\s+|--\\S+(?:=\\S+)?\\s+)*(?:${verbs})\\b`, 'i');
}

/** A push has landed when a successful shell step ran `git push`. */
const GIT_PUSH = gitCommandPattern('push');
/** A status observation, whether from the tool or from a raw shell call. */
const GIT_STATUS_CMD = gitCommandPattern('status');

/** The shell command a step ran, from either `{ command }` or `{ cmd }` args. */
export function commandOf(ev: BrainTraceEvent): string {
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
 * Did this step push?
 *
 * TWO forms, because there are two ways to push and only one of them used to count.
 * The raw form is a shell step whose command contains `git push` — which is what an
 * agent does when it hand-rolls publishing. The DECLARED form is the `git_push` tool,
 * whose args are `{ allowBaseBranch, repo }` and carry no command string at all, so
 * reading commands alone made the SAFE, intended route invisible: a run that shipped
 * through the tool never satisfied condition (1), and every delta ticket it had opened
 * stayed at 50% on the board forever — the exact bug this module exists to fix, left
 * open for the path we tell the agent to take.
 *
 * `open_pull_request` is deliberately NOT a push for this purpose: it puts the branch
 * on the remote, but a pull request is a request, and the merge is someone else's act.
 */
function isPush(ev: BrainTraceEvent): boolean {
  return ev.label === 'git_push' || GIT_PUSH.test(commandOf(ev));
}

/**
 * The file paths `git status --short` lists as changed or untracked, repo-relative.
 * A rename line (`R  old -> new`) yields the new path; git's quoting of paths with
 * spaces is undone.
 */
export function dirtyPathsOf(output: string): string[] {
  const out: string[] = [];
  for (const raw of output.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.length < 4 || line.startsWith('##')) continue;
    let path = line.slice(3);
    const arrow = path.indexOf(' -> ');
    if (arrow >= 0) path = path.slice(arrow + 4);
    path = path.trim().replace(/^"(.*)"$/, '$1');
    if (path) out.push(path);
  }
  return out;
}

/**
 * Is a workspace-relative file the run touched still listed as dirty? Status paths are
 * relative to the REPOSITORY, which sits one or more folders below the workspace root
 * in a multi-checkout workspace, so a touched path matches when it IS the status path
 * or ends with `/<status path>`.
 */
function touchedStillDirty(touched: readonly string[], dirty: readonly string[]): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '');
  const d = dirty.map(norm);
  return touched.map(norm).some((t) => d.some((p) => t === p || t.endsWith(`/${p}`)));
}

/**
 * Did this run push its work to a base branch and verify it landed?
 *
 * Requires a successful push, and then a status — recorded AT OR AFTER it — showing a
 * base branch, an upstream, and nothing left to push. Order matters: a status taken
 * BEFORE the push says nothing about whether the push worked. The push step itself
 * counts as the observation when its own output carries the status header — the
 * `git_push` tool prints `git status --short --branch` after pushing, so the declared
 * route verifies itself instead of depending on the model remembering a follow-up call.
 *
 * `touchedFiles` (workspace-relative) closes the last hole: a push of SOME commit while
 * the change this run made is still uncommitted. When the confirming status lists any
 * touched file as modified or untracked, the change did not ship, whatever the header
 * says.
 */
export function shippedToBaseBranch(
  events: readonly BrainTraceEvent[],
  opts?: { touchedFiles?: readonly string[] },
): boolean {
  const steps = events.filter((e) => e.category === 'tool');

  let pushedAt = -1;
  for (let i = 0; i < steps.length; i += 1) {
    if (succeeded(steps[i]) && isPush(steps[i])) pushedAt = i;
  }
  if (pushedAt < 0) return false;

  const touched = opts?.touchedFiles ?? [];
  for (let i = pushedAt; i < steps.length; i += 1) {
    const ev = steps[i];
    if (!succeeded(ev)) continue;
    const isStatus = i === pushedAt || ev.label === 'git_status' || GIT_STATUS_CMD.test(commandOf(ev));
    if (!isStatus) continue;
    const output = outputOf(ev);
    const status = parseGitShortStatus(output);
    if (!status) continue;
    if (!(status.branch && BASE_BRANCHES.has(status.branch) && status.upstream && status.ahead === 0)) continue;
    if (touched.length > 0 && touchedStillDirty(touched, dirtyPathsOf(output))) continue;
    return true;
  }
  return false;
}
