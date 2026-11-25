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

/** Maximum depth accepted when reading or preparing previously admitted child work. */
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
  /** Confident negatives the report states ("does not exist", "could not …") the owner must check before relaying; omitted when none. */
  unverifiedClaims?: string[];
}

/** A report line — never a bullet, so an issue that starts "Changed: …" stays an issue. */
const HEADING = /^[*_#>\s]*(outcome|changed|verified|checked|open issues)(?:\s*\(\d+\))?[*_]*\s*:\s*(.*)$/i;

/** Trim emphasis marks and whitespace from both ends in LINEAR time (a `[*_\s]+$` regex is
 *  quadratic on a long whitespace run that does not end the string). */
function stripMarks(s: string): string {
  const left = s.replace(/^[*_\s]+/, "");
  let end = left.length;
  while (end > 0 && /[*_\s]/.test(left[end - 1]!)) end--;
  return left.slice(0, end);
}
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
      const value = stripMarks(heading[2]!);
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
  const unverifiedClaims = findUnverifiedClaims(output, issues);
  return { ...(outcome ? { outcome } : {}), openIssues, ...(unverifiedClaims.length ? { unverifiedClaims } : {}) };
}

/**
 * Phrasings of a confident NEGATIVE ("X does not exist", "I could not add Y", "impossible").
 * Data, not logic: add a pattern here, nothing else changes. Deliberately narrow — "no errors",
 * "no changes needed", "nothing left" are ordinary report prose, not claims.
 */
const NEGATIVE_CLAIMS: readonly RegExp[] = [
  /\b(?:could\s*not|couldn't|cannot|can\s*not|can't|unable\s+to|failed\s+to\s+find)\s+\w+/i,
  /\b(?:does\s*not|doesn't|do\s*not|don't|did\s*not|didn't|is\s*not|isn't|are\s*not|aren't)\s+(?:exist|support|supported|possible|available|implemented|defined|provided)\b/i,
  /\b(?:nonexistent|non-existent|impossible|unfixable|infeasible|unsupportable)\b|\bnot\s+(?:possible|feasible|fixable)\b/i,
  /\b(?:has|have|had|there\s+is|there\s+are)\s+no\s+(?!(?:errors?|issues?|changes?|problems?|failures?|warnings?|blockers?|further|more|other|remaining|open|outstanding|need|longer|output|diff|differences?|new|effect|impact|regress\w*|side[\s-]effects?|type\s+errors?|behaviou?r|unresolved)\b)[\w-]+/i,
  /\bno\s+such\s+\w+/i,
  /\blacks?\s+\w+/i,
  /\b(?:is|are)\s+missing\s+from\b/i,
  /\bfound\s+no\s+(?:callers?|usages?|references?|uses?|consumers?|imports?)\b/i,
  /\b(?:isn't|aren't|is\s+not|are\s+not)\s+(?:wired|hooked|connected|registered|exported)\b/i,
  /\b(?:does\s*not|doesn't)\s+export\b/i,
  /\b(?:is|are)\s+never\s+(?:called|used|imported|invoked|referenced)\b/i,
  /\bnobody\s+(?:calls|uses|imports|references)\b/i,
  /\b(?:won't|will\s+not)\s+work\s+without\b/i,
];

/** Sentences that only DESCRIBE a negative (a fixed bug, a compiler or runtime message) — never a claim. */
const NOT_A_CLAIM: readonly RegExp[] = [
  /^(?:fix(?:ed|es)?|resolved?|resolves|addressed)\b/i,
  /\bwhere\b.*\b(?:could\s*not|couldn't|cannot|can't|unable\s+to)\b/i,
  /\b\w*Error\s*:/,
  /\berror\s+TS\d+/i,
];

/** Headings whose lines report what was DONE or RUN — their negatives are results, not findings. */
const RESULT_SECTIONS = new Set(["verified", "changed", "checked"]);

/** Abbreviations a sentence does not end at. */
const ABBREVIATIONS = ["e.g.", "i.e.", "etc.", "vs.", "cf."];

/** Claims an owner is handed from one report, and how long each may run. */
const MAX_UNVERIFIED_CLAIMS = 5;
/** The scan reads no more of a report than its owner is ever handed, and no line past this length. */
const CLAIM_SCAN_CHARS = 8_000;
const CLAIM_LINE_CHARS = 1_000;

/** Split a line into sentences, rejoining where the break followed an abbreviation. */
function splitSentences(line: string): string[] {
  const out: string[] = [];
  for (const piece of line.split(/(?<=[.!?])\s+/)) {
    const prev = out[out.length - 1];
    const lower = prev?.toLowerCase();
    if (prev !== undefined && ABBREVIATIONS.some((a) => lower!.endsWith(a) && !/[a-z]/.test(lower!.charAt(lower!.length - a.length - 1)))) {
      out[out.length - 1] = `${prev} ${piece}`;
    } else out.push(piece);
  }
  return out;
}

/**
 * The sentences of a report that assert a negative the owner could relay as fact — outside
 * code fences and result sections (Verified / Changed / Checked), and not already carried as
 * an open issue (those reach the owner as work). Past the cap, one "…and N more" entry.
 */
function findUnverifiedClaims(output: string, capturedIssues: readonly string[]): string[] {
  const claims: string[] = [];
  let inFence = false;
  let inResults = false;
  for (const raw of output.slice(0, CLAIM_SCAN_CHARS).split(/\r?\n/)) {
    if (FENCE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || raw.length > CLAIM_LINE_CHARS) continue;
    if (!raw.trim()) {
      inResults = false;
      continue;
    }
    const heading = HEADING.exec(raw);
    if (heading) inResults = RESULT_SECTIONS.has(heading[1]!.toLowerCase());
    if (inResults) continue;
    const line = (heading ? heading[2]! : raw).replace(BULLET, "").trim();
    for (const sentence of splitSentences(line)) {
      const text = stripMarks(sentence);
      if (!text || NOT_A_CLAIM.some((p) => p.test(text)) || capturedIssues.some((i) => i.includes(text))) continue;
      const clipped = clipIssue(text);
      if (NEGATIVE_CLAIMS.some((p) => p.test(text)) && !claims.includes(clipped)) claims.push(clipped);
    }
  }
  if (claims.length <= MAX_UNVERIFIED_CLAIMS) return claims;
  const more = claims.length - MAX_UNVERIFIED_CLAIMS;
  return [...claims.slice(0, MAX_UNVERIFIED_CLAIMS), `…and ${more} more — see the full report`];
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
    "Use the tools available in this run to carry out your slice end to end. Do the work yourself and report back to your owner.",
    "Do not spawn additional sub-agents.",
    "Answer with concrete findings: exact file paths, names and line references, and an explicit \"not found\" where that is the honest result.",
    "Never end with a promise to continue; finish the slice, then report.",
  ].join("\n");
}
