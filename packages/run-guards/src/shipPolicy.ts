/**
 * SHIP POLICY (PRD 48 §2) — what an autonomous run does with finished work, as a standing
 * RULE rather than a mid-run question. ONE contract for every host:
 *
 *  - it is a PROJECT setting, stored per tenant and read/written through the API
 *    (`GET`/`PUT /api/manager/:projectId`, the `manager.configure` MCP tool);
 *  - the VS Code extension fetches the project's effective policy per run, and
 *    brain-embedded narrows it for a sub-agent (`leave_uncommitted`) or a chat-scoped
 *    publish hold;
 *  - the cloud maps it from the same project settings (`pull_request`, merge by the sweep).
 *
 * Everything that decides or states shipping reads this module, so the directive the model
 * reads, the nudge that re-prompts it, and the tool gate that refuses a publish can never
 * disagree: {@link publishVerbOf} is THE publish matcher, {@link publishAllowed} THE gate,
 * {@link shipDirective} / {@link shipNudge} THE prose.
 *
 * Pure: strings, sets and predicates — safe in every bundle.
 */

import { VERIFY_STEP } from "@builderforce/agent-tools";
import { shellCommandOf } from "./checkCommand.js";
import { gitCommandPattern } from "./evidence/gitCommandPattern.js";
import { PUBLISH_TOOLS } from "./inRunVerify.js";

/** What the run does with a finished change. */
export type ShipMode = "leave_uncommitted" | "commit" | "commit_push" | "pull_request";

/** Where a policy came from — named in the directive, the refusal, diagnostics and the final report. */
export type ShipPolicySource = "project_settings" | "chat_hold" | "subagent" | "person_grant" | "default";

/** The chat turn that set a publish hold (`brain-embedded` `runStore/publishHold.ts`). */
export interface ShipHold {
  /** 1-based position of the user turn that set the hold. */
  messageNumber: number;
  /** That turn's words — quoted on a refusal so the model sees the exact instruction. */
  text: string;
}

export interface ShipPolicy {
  mode: ShipMode;
  /** pull_request only: when the PR merges. 'never' = a human merges. */
  merge: "never" | "immediate" | "on_green";
  /** pull_request only: a recorded independent review/sign-off is required before merge. */
  review: "none" | "required";
  /** Provenance, shown in the directive and diagnostics. */
  source: ShipPolicySource;
  /** Set by {@link narrowByHold}: the chat turn holding every publish. */
  hold?: ShipHold;
}

/** The four modes, loosest-last — the order a settings picker offers them in. */
export const SHIP_MODES: readonly ShipMode[] = ["leave_uncommitted", "commit", "commit_push", "pull_request"];

/** The project has no ship policy yet: commit locally (reversible, never leaves the machine), never ask. */
export const DEFAULT_SHIP_POLICY: ShipPolicy = Object.freeze({
  mode: "commit",
  merge: "never",
  review: "none",
  source: "default",
}) as ShipPolicy;

export function isShipMode(value: unknown): value is ShipMode {
  return typeof value === "string" && (SHIP_MODES as readonly string[]).includes(value);
}

/** A policy for a mode, with the defaults for the pull-request fields. */
export function shipPolicyOf(mode: ShipMode, source: ShipPolicySource): ShipPolicy {
  return { mode, merge: "never", review: "none", source };
}

// ── The publish matcher ───────────────────────────────────────────────────────

/** `merge` = merging a pull request (`gh pr merge`): refused in EVERY mode — runs never merge; the PR merge sweep does. */
export type PublishVerb = "commit" | "push" | "pull_request" | "cleanup" | "merge";

/**
 * Which host states the policy to the model. `editor` (the VS Code run) publishes with its own
 * git tools; `cloud` (a cloud run, or an on-prem agent host) has its run branch turned into a
 * pull request by the PLATFORM when the run ends, so its prose names no git tools.
 */
export type ShipHost = "editor" | "cloud";

/**
 * The local tools that publish work OUT of the checkout: the in-run {@link PUBLISH_TOOLS}
 * plus `git_cleanup_merged` (it deletes the merged branch on origin). ONE list — the
 * read-cache invalidation in brain-embedded (`localWorkspaceTools.ts`) reads this set.
 */
export const REPO_PUBLISH_TOOLS: ReadonlySet<string> = new Set([...PUBLISH_TOOLS, "git_cleanup_merged"]);

const TOOL_VERBS: Readonly<Record<string, PublishVerb>> = {
  git_commit: "commit",
  git_push: "push",
  open_pull_request: "pull_request",
  git_cleanup_merged: "cleanup",
};

const RAW_COMMIT = gitCommandPattern("commit");
const RAW_PUSH = gitCommandPattern("push");
/** A `gh pr <sub>` command, however gh's own flags (`--repo x`, `-R x`) precede the subcommand. */
const ghPr = (sub: string): RegExp => new RegExp(`\\bgh\\s+(?:-{1,2}[\\w-]+(?:[=\\s]+[^-\\s]\\S*)?\\s+)*pr\\s+(?:${sub})\\b`, "i");
/** `gh pr create`, and its alias `gh pr new`. */
const RAW_PR_CREATE = ghPr("create|new");
const RAW_PR_MERGE = ghPr("merge");
/**
 * A merge through the provider's REST API: `gh api … pulls/N/merge`, or `curl` / `wget` to a
 * `/pulls/N/merge` (GitHub) or `/merge_requests/N/merge` (GitLab) URL.
 */
const RAW_API_MERGE = /\b(?:gh\s+api|curl|wget)\b[^;&|\n]*?\/?(?:pulls|merge_requests)\/\d+\/merge\b/i;

/**
 * THE publish matcher: which publish a call is, or null. The publish tools by name, and a
 * `run_command` (any — background included) whose command is a raw `gh pr merge` or a merge
 * through the provider API (`gh api` / `curl` / `wget` to `…/pulls/N/merge`), `gh pr create` /
 * `gh pr new`, `git push` or `git commit`. A command that does several names the widest of them.
 */
export function publishVerbOf(tool: string, args: unknown): PublishVerb | null {
  if (REPO_PUBLISH_TOOLS.has(tool)) return TOOL_VERBS[tool] ?? null;
  if (tool !== "run_command") return null;
  const command = shellCommandOf(args);
  if (!command) return null;
  if (RAW_PR_MERGE.test(command) || RAW_API_MERGE.test(command)) return "merge";
  if (RAW_PR_CREATE.test(command)) return "pull_request";
  if (RAW_PUSH.test(command)) return "push";
  if (RAW_COMMIT.test(command)) return "commit";
  return null;
}

const BASE_BRANCH = /^(?:main|master)$/i;
const RAW_PUSH_TAIL = /\bgit\s+(?:-[Cc]\s+\S+\s+|-\S+\s+|--\S+(?:=\S+)?\s+)*push\b([^;&|\n]*)/i;
/** `git push` flags that take their value as the NEXT token — that token is not an operand. */
const PUSH_VALUE_FLAGS: ReadonlySet<string> = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);
/** A destination that means "whatever is checked out" — may be the base branch. */
const CURRENT_BRANCH = /^(?:HEAD|@)$/;

/** Shell wrapping around a token: quotes, backticks, `$(` … `)`, brackets and braces. */
const SHELL_WRAP = /^(?:\$\(|[\s"'`([{])+|[\s"'`)\]};]+$/g;

/**
 * The operands of a raw `git push` tail (remote first, then refspecs), flags and their values
 * skipped, and the shell's quoting stripped (`'main'`, `main"` from `bash -c "git push origin
 * main"`, `main)` from `$(git push origin main)`).
 */
function pushOperands(tail: string): string[] {
  const tokens = tail.trim().split(/\s+/).map((t) => t.replace(SHELL_WRAP, "")).filter(Boolean);
  const operands: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.startsWith("-")) {
      if (PUSH_VALUE_FLAGS.has(t)) i++;
      continue;
    }
    operands.push(t);
  }
  return operands;
}

/**
 * Does this publish land on the base branch? `git_push` says so with `allowBaseBranch`; a raw
 * `git push` does when a refspec's destination names main/master, or when it names no branch
 * at all — no refspec, or a bare `HEAD` / `@` — because that pushes the current branch, which
 * may be the base (refused rather than guessed).
 */
function pushesBaseBranch(tool: string, args: unknown): boolean {
  if (tool === "git_push") return (args as { allowBaseBranch?: unknown } | null)?.allowBaseBranch === true;
  if (tool !== "run_command") return false;
  const tail = RAW_PUSH_TAIL.exec(shellCommandOf(args))?.[1];
  if (tail === undefined) return false;
  const refspecs = pushOperands(tail).slice(1);
  if (refspecs.length === 0) return true;
  return refspecs.some((spec) => {
    const s = spec.replace(/^\+/, "");
    // Still shell-expanded after stripping (`$BRANCH`, a nested substitution): unknown, so refused.
    if (/[$`]/.test(s)) return true;
    const colon = s.indexOf(":");
    if (colon < 0 && CURRENT_BRANCH.test(s)) return true;
    const dst = colon < 0 ? s : s.slice(colon + 1);
    return BASE_BRANCH.test(dst.replace(/^refs\/heads\//, ""));
  });
}

// ── The gate ──────────────────────────────────────────────────────────────────

/** "the project's settings", "this chat's publish hold", … */
export function shipSourceLabel(p: ShipPolicy): string {
  switch (p.source) {
    case "project_settings":
      return "the project's settings";
    case "chat_hold":
      return p.hold
        ? `this chat's publish hold (set by user message #${p.hold.messageNumber}: "${p.hold.text.slice(0, 200)}")`
        : "this chat's publish hold";
    case "subagent":
      return "the sub-agent rule (the owner run ships once, after verifying the fan-out)";
    case "person_grant":
      return "a person's merge grant for this run";
    case "default":
      return "the default — the project's ship policy is unset";
  }
}

const MODE_SENTENCE: Readonly<Record<ShipMode, string>> = {
  leave_uncommitted: "leave every change uncommitted",
  commit: "commit locally, never push or open a pull request",
  commit_push: "commit and push the base branch, never open a pull request",
  pull_request: "push a branch and open a pull request, never push the base branch or merge",
};

/** The mode as a host states it: on `cloud` the platform, not the run, opens the pull request. */
function modeSentence(p: ShipPolicy, host: ShipHost): string {
  if (host === "cloud" && p.mode === "pull_request") {
    return "your changes on the run branch become a pull request when the run ends, never push or merge the base branch";
  }
  return MODE_SENTENCE[p.mode];
}

/** What a refused run does instead, per mode — the editor host, which publishes with its own tools. */
const INSTEAD: Readonly<Record<ShipMode, string>> = {
  leave_uncommitted: "Leave the changes uncommitted and finish with the list of changed paths and what still needs validation.",
  commit: "Keep the commit local and report its hash; do not push.",
  commit_push: "Commit and push the base branch instead; do not open a pull request.",
  pull_request: "Commit on a branch, push that branch and open_pull_request instead.",
};

/** What a refused CLOUD run does instead: it never publishes itself — the platform opens the PR. */
const CLOUD_INSTEAD =
  "Keep your changes on the run branch and finish the run: the platform opens the pull request when it ends.";

const NEVER_MERGE =
  "A run never merges a pull request: the project's merge sweep merges it by the project's settings (merge authority, merge timing, sign-off).";

/**
 * THE publish gate: may this run make this call under its ship policy? Not a publish →
 * allowed. A `merge` is refused in EVERY mode (runs never merge). `leave_uncommitted` refuses
 * every verb; `commit` refuses push, cleanup and PR; `commit_push` refuses a PR;
 * `pull_request` refuses a push (or cleanup) of the base branch. `host` only words the refusal.
 */
export function publishAllowed(
  p: ShipPolicy, tool: string, args: unknown, host: ShipHost = "editor",
): { ok: true } | { ok: false; error: string } {
  const verb = publishVerbOf(tool, args);
  if (!verb) return { ok: true };
  let refused: boolean;
  if (verb === "merge") refused = true;
  // CLOUD: the platform opens the pull request, so a raw shell push / PR / merge is never the
  // run's to make — refused categorically rather than by parsing refspecs (a quoted, nested or
  // `bash -c` command, or a base branch named `develop` / `trunk`, cannot slip through), and a
  // second `gh pr create` can never open a duplicate PR.
  else if (host === "cloud" && tool === "run_command" && (verb === "push" || verb === "pull_request")) refused = true;
  else switch (p.mode) {
    case "leave_uncommitted":
      refused = true;
      break;
    case "commit":
      refused = verb !== "commit";
      break;
    case "commit_push":
      refused = verb === "pull_request";
      break;
    case "pull_request":
      refused = (verb === "push" || verb === "cleanup") && pushesBaseBranch(tool, args);
      break;
  }
  if (!refused) return { ok: true };
  const what = verb === "pull_request" ? "pull request" : verb === "merge" ? "merge" : verb;
  const instead = verb === "merge" ? NEVER_MERGE : host === "cloud" ? CLOUD_INSTEAD : INSTEAD[p.mode];
  return {
    ok: false,
    error:
      `Ship policy refused this ${what}: the policy is \`${p.mode}\` (${modeSentence(p, host)}), set by ${shipSourceLabel(p)}. ` +
      `${instead} Do not ask the person to change it mid-run; state the policy in your final report.`,
  };
}

// ── Narrowing ─────────────────────────────────────────────────────────────────

/**
 * How far each mode lets work travel. `pull_request` ranks below `commit_push`: it reaches
 * the base branch only through a reviewed merge the run never performs.
 */
const MODE_RANK: Readonly<Record<ShipMode, number>> = { leave_uncommitted: 0, commit: 1, pull_request: 2, commit_push: 3 };
const MERGE_RANK: Readonly<Record<ShipPolicy["merge"], number>> = { never: 0, on_green: 1, immediate: 2 };

/**
 * The stricter of two policies — how a workspace value narrows the User value. `to` can
 * only take away: a looser `to` leaves `p` as it is, with its own source.
 */
export function narrowShipPolicy(p: ShipPolicy, to: ShipPolicy | null): ShipPolicy {
  if (!to) return p;
  if (MODE_RANK[to.mode] < MODE_RANK[p.mode]) return to;
  if (MODE_RANK[to.mode] > MODE_RANK[p.mode]) return p;
  const merge = MERGE_RANK[to.merge] < MERGE_RANK[p.merge] ? to.merge : p.merge;
  const review = to.review === "required" || p.review === "required" ? "required" : "none";
  if (merge === p.merge && review === p.review) return p;
  return { ...p, merge, review, source: to.source };
}

/**
 * A chat's publish hold narrows any policy to `leave_uncommitted`, naming the turn that set it.
 * A sub-agent's policy already ships nothing and keeps its own (truer) source.
 */
export function narrowByHold(p: ShipPolicy, hold: ShipHold | null): ShipPolicy {
  if (!hold) return p;
  if (p.source === "subagent") return p;
  return { mode: "leave_uncommitted", merge: "never", review: p.review, source: "chat_hold", hold: { messageNumber: hold.messageNumber, text: hold.text } };
}

// ── The prose ─────────────────────────────────────────────────────────────────

/** What the final report says about the policy — says where to set it when nobody chose one. */
function finalReportLine(p: ShipPolicy): string {
  const named = p.source === "default"
    ? ` Then add: "The project's ship policy is unset — set it (leave_uncommitted, commit, commit_push or pull_request) in the project's settings, or ask me to set it."`
    : "";
  return `FINAL REPORT — state the policy you shipped under, as "Ship policy: ${p.mode} (${shipSourceLabel(p)})".${named}`;
}

const NEVER_ASK =
  "This is a standing rule, not a question: never ask the person whether to commit, push or open a pull request (not in prose, not with ask_user), and never ask them to approve a publish — the policy IS their approval.";

const REVIEW_CHECKLIST =
  "against what the ticket and the user asked for: bugs, leftover debug code, edits unrelated to the task, missing tests or localisation. If you find a problem, FIX it and review again. Do NOT record builtin_reviews_record with verdict \"complete\" yourself: the author never records its own completion review — the independent review the ship gate runs over your diff records it.";

const SELF_REVIEW = `SELF-REVIEW — read your own diff with \`git_diff\` ${REVIEW_CHECKLIST}`;

const CLOUD_SELF_REVIEW = `SELF-REVIEW — re-read every file you changed ${REVIEW_CHECKLIST}`;

/** Who merges the pull request, and whether a review must be recorded first — from the policy. */
function mergeSentence(p: ShipPolicy): string {
  // PRD 48 §4.6: a person granted this ONE run's merge — the platform (never the run) merges it.
  if (p.source === "person_grant") {
    return "A person authorized merging this pull request into main: the platform merges it once the security scan and CI pass. Never merge or push the base branch yourself.";
  }
  const merge = p.merge === "never"
    ? "A human merges it."
    : p.merge === "on_green"
      ? "The project's merge sweep merges it once CI is green."
      : "The project's merge sweep merges it once it is opened.";
  const review = p.review === "required" ? " An independent review or sign-off must be recorded before it merges." : "";
  return `${merge}${review}`;
}

function shipStep(p: ShipPolicy, host: ShipHost): string {
  if (host === "cloud") {
    return "SHIP — your changes on the run branch are the deliverable; when the run ends the platform opens the pull request. " +
      `Never push or merge the base branch, and do not try to open the pull request yourself — ${mergeSentence(p)}`;
  }
  const paths = "exactly the `paths` you changed (never a catch-all: the tree may hold the human's own work)";
  switch (p.mode) {
    case "commit":
      return `SHIP — \`git_commit\` with allowBaseBranch:true and ${paths}. Do NOT push and do not open a pull request: the policy keeps the commit local.`;
    case "commit_push":
      return `SHIP — \`git_commit\` with allowBaseBranch:true and ${paths}, then \`git_push\` with allowBaseBranch:true. Do not open a pull request.`;
    case "pull_request":
      return `SHIP — \`git_commit\` on a \`branch\` with ${paths}, \`git_push\` that branch (never allowBaseBranch), then \`open_pull_request\`. Never push the base branch and never merge — ${mergeSentence(p)}`;
    case "leave_uncommitted":
      return "";
  }
}

/** The self-review step: the editor reads its diff with `git_diff`; a cloud run re-reads the files it changed. */
function selfReview(host: ShipHost): string {
  return host === "cloud" ? CLOUD_SELF_REVIEW : SELF_REVIEW;
}

function closeStep(p: ShipPolicy, trackingTicket: string, host: ShipHost): string {
  if (host === "cloud") {
    return "CLOSE — finish the run with a summary of what you changed and how you verified it. The ticket closes when the pull request merges; do not move it to done yourself. Move any OTHER linked ticket this change fully delivers with builtin_tasks_update.";
  }
  const others = "Move any OTHER linked ticket this change fully delivers with builtin_tasks_update.";
  switch (p.mode) {
    case "commit":
      return `CLOSE — report the commit hash. The ticket tracking this change (${trackingTicket}) stays in review until the commit is pushed. ${others}`;
    case "commit_push":
      return `CLOSE — the push reports the branch it landed on. Once it lands on the base branch with nothing left to push, the in_review ticket tracking this change (${trackingTicket}) moves to done automatically. Never defer the close-out to a later run or ask the user to continue for it. ${others} Report the commit hash and the push result.`;
    case "pull_request":
      return `CLOSE — report the pull request. The ticket tracking this change (${trackingTicket}) closes when the PR merges. ${others}`;
    case "leave_uncommitted":
      return "";
  }
}

/**
 * THE ship directive for every host. Verify → self-review → ship (by mode) → close → state
 * the policy, or — for `leave_uncommitted` — verify and leave the change for the person.
 * `chatId`, when the run has a server chat, names where its tracking ticket is listed.
 * `host` (default `editor`) picks the wording: a `cloud` host's run never publishes itself, so
 * its ship and close steps name no git tools — the platform opens the pull request.
 */
export function shipDirective(p: ShipPolicy, context: { chatId?: number | null; host?: ShipHost } = {}): string {
  const host = context.host ?? "editor";
  const head = `SHIP POLICY — ${modeSentence(p, host)} (\`${p.mode}\`, set by ${shipSourceLabel(p)}). ${NEVER_ASK}`;
  if (p.mode === "leave_uncommitted") {
    const who = p.source === "subagent"
      ? " You are a sub-agent: your owner verifies the whole fan-out and ships it once, so report the paths you changed and how you verified them."
      : "";
    return (
      `${head}\n` +
      "Do NOT run git_commit, git_push, open_pull_request or git_cleanup_merged, and do not publish through a raw `git commit` / `git push` / `gh pr create` shell command — the tool gate refuses them." +
      `${who}\n` +
      `1. VERIFY — ${VERIFY_STEP}\n` +
      "2. LEAVE IT — finish your turn with the list of changed paths and what still needs validation, so the person can review.\n" +
      `3. ${finalReportLine(p)}`
    );
  }
  const trackingTicket = context.chatId != null
    ? `builtin_chats_list_tickets with chatId=${context.chatId} lists it`
    : "the one builtin_tickets_from_delta returned for it";
  return (
    `${head} When your turn changes code, finish it in this order:\n` +
    `1. VERIFY — ${VERIFY_STEP}\n` +
    `2. ${selfReview(host)}\n` +
    `3. ${shipStep(p, host)}\n` +
    `4. ${closeStep(p, trackingTicket, host)}\n` +
    `5. ${finalReportLine(p)}\n` +
    (host === "cloud"
      ? "If a check fails or a call is refused, report the exact error — never claim a change is verified or shipped when it is not."
      : "If a commit, push or pull request is refused or fails, report the exact error — never claim a change shipped when it did not.")
  );
}

/**
 * THE "you left it unshipped" re-prompt, or null when the mode ships nothing. Concedes the
 * edit is made and names what is left, rather than accusing the model of doing nothing.
 */
export function shipNudge(p: ShipPolicy, host: ShipHost = "editor"): string | null {
  if (p.mode === "leave_uncommitted") return null;
  if (host === "cloud") {
    return (
      `You changed code in this run and ended the turn without finishing it. The ship policy is \`${p.mode}\` (set by ${shipSourceLabel(p)}) — finish it now, without asking:` +
      ` verify it, re-read every file you changed, then finish the run with a summary — the platform opens the pull request when the run ends; never push or merge the base branch.` +
      " If you genuinely cannot finish — the change is incomplete, or verification fails and you cannot fix it — say so plainly at the TOP of your answer and name exactly what is left."
    );
  }
  const ship = p.mode === "commit"
    ? "`git_commit` (allowBaseBranch:true, exactly the paths you changed) — do not push"
    : p.mode === "commit_push"
      ? "`git_commit` (allowBaseBranch:true, exactly the paths you changed) and `git_push` (allowBaseBranch:true)"
      : "`git_commit` on a `branch` (exactly the paths you changed), `git_push` that branch and `open_pull_request`";
  return (
    `You changed code in this run and ended the turn without shipping it. The ship policy is \`${p.mode}\` (set by ${shipSourceLabel(p)}) — finish it now, without asking:` +
    ` verify it — ${VERIFY_STEP} Then self-review your diff with \`git_diff\`, then ${ship}.` +
    " If you genuinely cannot ship — the change is unfinished, or verification fails and you cannot fix it — say so plainly at the TOP of your answer and name exactly what is left."
  );
}
