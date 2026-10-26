/**
 * The standing instructions of a SUB-AGENT — the one thing about a child that is not
 * the ordinary run it is.
 *
 * A child runs through the same loop as any run, on every surface: the editor starts it
 * as a run with an owner pointer (`runLineage.ts`), the cloud as a durable execution with
 * one (`cloudChildRuns.ts`). It works beside its owner, hears direction from it, and its
 * final message is its report. What it is TOLD about that relationship is decided once,
 * here, or the two surfaces would delegate to subtly different children.
 *
 * Zero dependencies, like the rest of this package.
 */

/**
 * WHO the child is acting AS, when the owner delegated to one of the workspace's own
 * agents rather than to an anonymous helper.
 *
 * `brief` is the agent's compiled persona prompt — its role, bio, skills and personality,
 * built by whichever surface owns that compilation. This package never builds one; it
 * only decides WHERE the brief goes.
 */
export interface SubagentPersona {
  name: string;
  brief: string;
}

/** How deep sub-agents nest — a child at this depth does its slice itself. ONE cap for
 *  the editor's children and the cloud's. */
export const MAX_SUBAGENT_DEPTH = 3;

/** The agent a child reports to. */
export interface SubagentLiveOwner {
  /** Display name of the owner, as the chat shows it. */
  owner: string;
  /** The delegation's role (`verify`, `code`, `explore`, …) — picks the report's shape. */
  role?: string;
}

/**
 * The report a child ENDS with. Its owner acts on it rather than reading it as prose:
 * `Open issues` comes back to the owner as work it must resolve (`parseSubagentReport`),
 * so nothing a child left undone or found broken is lost in a paragraph.
 *
 * A `verify` child CHECKS: it runs the narrowest checks that cover the change and reports
 * every failure verbatim, and the coder fixes what it reports. The checks run on the
 * verify role's cheaper models; the fixes stay with the strongest coder.
 */
const REPORT_LINES = {
  default: [
    "Outcome: done | partial | failed",
    "Changed: the files you changed, or none",
    "Verified: what you ran to check your work and its result, or not run",
    "Open issues: each thing left undone, broken, or outside your slice — or none",
  ],
  verify: [
    "Outcome: pass | fail",
    "Checked: each command you ran and its result",
    "Open issues: each failure — the command, the file and line, and the failing output verbatim — or none",
  ],
} as const;

// The child's half of `VERIFY_DELEGATION_STEP` (agent-tools), which tells the OWNER to
// delegate the checking; restated here because this package keeps zero dependencies.
const VERIFY_JOB =
  "Your job is to CHECK the change, not to fix it: run the narrowest type-check, build and tests that cover the files it touched (never a full sweep), and report what failed. Do not patch failures — the coder fixes what you report.";

function reportContract(role: string | undefined, owner: string): string[] {
  const verifying = role === "verify";
  return [
    ...(verifying ? [VERIFY_JOB] : []),
    `Your FINAL message is your report to ${owner}, who acts on it — so it must stand alone. End it with these lines, each filled in:`,
    ...(verifying ? REPORT_LINES.verify : REPORT_LINES.default),
  ];
}

/** What a child's report says about the work left — read where the report is built. */
export interface ParsedSubagentReport {
  /** The `Outcome:` word, lower-cased, when the report has one. */
  outcome?: string;
  /** Each `Open issues:` item; empty when the report says none (or has no such line). */
  openIssues: string[];
}

/** A report line — never a bullet, so an issue that starts "Changed: …" stays an issue. */
const HEADING = /^\s*[*_#>\s]*(outcome|changed|verified|checked|open issues)(?:\s*\(\d+\))?[*_]*\s*:\s*(.*)$/i;
/** The words an outcome may be; prose after `Outcome:` is not one. */
const OUTCOME = /^(done|partial|failed|fail|passed|pass)\b/i;
/** "None", "None — all pass", "No open issues", "Nothing outstanding", "N/A (…)" — clean. */
/** Narrow on purpose: "None of the tests ran" and "Nothing renders in Safari" are issues. */
const NONE =
  /^(?:none(?:\s*[—–\-:(.,]|\s+(?:identified|found|known|remaining|outstanding|left)\b|\s*$)|nothing(?:\s+(?:outstanding|left|remaining|open|to\s+\w+))?\s*[.!]?\s*$|n\/a\b|no\s+(?:open\s+|outstanding\s+|remaining\s+|known\s+|further\s+)?(?:issues?|problems?|failures?|blockers?)\b|[-—]+$)/i;
const BULLET = /^\s{0,3}(?:[-*•]|\d+[.)])\s+/;
const FENCE = /^\s*(```|~~~)/;
const FAILED_OUTCOMES = new Set(["failed", "fail", "partial"]);

/** Issues an owner is handed from one report, and how long each may run — the full text
 *  is in the report itself, which the owner also reads. */
const MAX_OPEN_ISSUES = 8;
const MAX_ISSUE_CHARS = 600;

const clipIssue = (s: string): string => (s.length > MAX_ISSUE_CHARS ? `${s.slice(0, MAX_ISSUE_CHARS)}…` : s);

/**
 * Read the report a child ended with. Lenient by design — a model that bolds a heading
 * or numbers its issues is still understood — and silent on a report without the lines
 * (an older child, a stopped one): no line, no parsed issues.
 *
 * ONE issue per bullet: the verbatim failure output a verify child pastes under an issue
 * (code fences, stack lines, indented continuations) folds into that issue rather than
 * becoming dozens, and a blank line after the items ends the list, so closing prose is
 * not read as more work.
 */
export function parseSubagentReport(output: string): ParsedSubagentReport {
  let outcome: string | undefined;
  let issues: string[] = [];
  let inIssues = false;
  let inFence = false;
  const fold = (text: string): void => {
    if (issues.length === 0) issues.push(text);
    else issues[issues.length - 1] = `${issues[issues.length - 1]}\n${text}`;
  };
  for (const raw of output.split(/\r?\n/)) {
    if (inIssues && FENCE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inIssues && inFence) {
      if (raw.trim()) fold(raw.trimEnd());
      continue;
    }
    const heading = HEADING.exec(raw);
    if (heading) {
      const key = heading[1]!.toLowerCase();
      const value = heading[2]!.replace(/^[*_\s]+|[*_\s]+$/g, "");
      inIssues = key === "open issues";
      if (key === "outcome") outcome = OUTCOME.exec(value)?.[1]?.toLowerCase() ?? outcome;
      if (inIssues) issues = value && !NONE.test(value) ? [value] : [];
      continue;
    }
    if (!inIssues) continue;
    if (!raw.trim()) {
      if (issues.length > 0) inIssues = false;
      continue;
    }
    if (BULLET.test(raw)) {
      const item = raw.replace(BULLET, "").trim();
      if (item && !NONE.test(item)) issues.push(item);
    } else if (!NONE.test(raw.trim())) {
      fold(raw.trim());
    }
  }
  const openIssues = issues.slice(0, MAX_OPEN_ISSUES).map(clipIssue);
  if (issues.length > MAX_OPEN_ISSUES) openIssues.push(`…and ${issues.length - MAX_OPEN_ISSUES} more — see the full report`);
  if (openIssues.length === 0 && outcome && FAILED_OUTCOMES.has(outcome)) {
    openIssues.push(`the sub-agent reported its slice ${outcome} without naming what is left`);
  }
  return { ...(outcome ? { outcome } : {}), openIssues };
}

/**
 * The child's standing instructions.
 *
 * A PERSONA goes FIRST, above the sub-agent rules. The order is the point: identity
 * frames the work ("you are Ada, the workspace's data engineer — and here is how a
 * sub-agent behaves"), whereas appending it would read as an afterthought the model
 * discards once the rules have set the tone. The sub-agent rules still follow and still
 * win on procedure: a persona changes the VOICE and the EXPERTISE, never the requirement
 * to finish with a standalone report.
 *
 * Nothing here narrows the child. It is a CLONE of its owner — the same tools, the same
 * execution — so it is told to carry its slice out, not what it may not touch.
 */
export function subagentSystemPrompt(persona: SubagentPersona | undefined, live: SubagentLiveOwner): string {
  const identity = persona
    ? [
      `You are acting as ${persona.name}, one of this workspace's agents. Stay in that agent's role and voice.`,
      persona.brief,
    ]
    : [];
  return [
    ...identity,
    `You are a sub-agent spawned by ${live.owner}, which owns this work and keeps working while you do your slice. It sees only what you post.`,
    ...reportContract(live.role, live.owner),
    `${live.owner} (or the person it works for) may redirect you mid-task: a message beginning "[${live.owner}]" is direction from your owner — follow it over your original brief.`,
    "You hold every tool your owner holds. Carry your slice out end to end — investigate, change, run and record what it needs — and keep to the slice you were given.",
    "Answer with concrete findings: exact file paths, names and line references, and an explicit \"not found\" where that is the honest result.",
    "Never end with a promise to continue; finish the slice, then report.",
  ].join("\n");
}
