/**
 * What a run already READ, from its own trace — the two packets a delegation carries.
 *
 *   - owner → child: {@link establishedCalls} — the files (with windows) and data calls the
 *     owner already made, appended to the child's brief under `ownerHandoffBlock`'s heading
 *     so the child does not re-derive them (VS Code chat #273: the child re-probed the
 *     ticket status counts and re-calibrated paging the owner had already settled).
 *   - child → owner: {@link coverageOf} (what the child read, with offsets) and
 *     {@link collectedDataText} (every result those calls returned, saved by
 *     `childDataFile.ts`), so the owner reads the child's data from a file instead of
 *     re-fetching the pages (chat #273: 41 calls' rows were lost and the owner re-fetched them).
 *
 * Pure over the trace rows the host already keeps (`getRunTrace`); arguments are compared
 * in the read guard's canonical form (`canonicalReadArgs`) so `./a/b` and `a/b` are one read.
 * Everything that leaves the run — an argument in a brief or a report, a result in the
 * data file — passes through `redactText` first.
 *
 * LIMIT: the run store keeps only the last 500 trace events per run (`MAX_TRACE_EVENTS`
 * in brain-embedded `runCells.ts`), so a very long run's EARLIEST calls may be missing
 * from all three packets. They are a record of what is known, never a claim of completeness.
 */

import {
  READ_DEFAULT_LINE_LIMIT,
  SUBAGENT_CONTROL_TOOL_NAMES,
  stableStringify,
  toolSideEffect,
} from "@builderforce/agent-tools";
import { canonicalReadArgs } from "@builderforce/run-guards";
import { redactText } from "@builderforce/secret-redaction";

/** One trace row as this module reads it (`BrainTraceEvent`'s relevant subset). */
export interface CoverageStep {
  category: string;
  label: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
}

/** Catalog READS that are not data: waiting on children, finishing, asking, polling a job. */
const NON_DATA_READS = new Set<string>([SUBAGENT_CONTROL_TOOL_NAMES.wait, "finish", "ask_human", "command_status"]);

/** Longest single argument value shown; longest compact argument list. */
const ARG_VALUE_CHARS = 80;
const ARGS_CHARS = 180;

/** Windows listed on one file's line before the rest are counted. */
export const MAX_WINDOWS_PER_LINE = 6;

/** Cap on the collected-data file — a child that paged a whole board still fits. */
export const COLLECTED_DATA_CHARS = 4_000_000;

/**
 * A call that brought data back: a successful tool step that the shared catalog classes as
 * a read (minus the control reads), or a tool the catalog does not know — a platform /
 * MCP call such as `builtin_tasks_list`, whose result is exactly the data a delegation
 * collects. A catalog write, check or shell command is not data.
 */
export function isDataCall(step: CoverageStep): boolean {
  if (step.category !== "tool" || step.isError || step.label.includes(".")) return false;
  if (resultFailed(step.result)) return false;
  const effect = toolSideEffect(step.label);
  if (effect === undefined) return true;
  return effect === "read" && !NON_DATA_READS.has(step.label);
}

function resultFailed(result: unknown): boolean {
  const data = asRecord(result);
  return !!data && data.ok === false;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string" && value.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

const argsRecord = (args: unknown): unknown => (typeof args === "string" ? asRecord(args) : args);

/** A call's arguments as one short line — canonical form, secrets redacted, long values clipped. */
export function compactArgs(tool: string, args: unknown): string {
  const canonical = canonicalReadArgs(tool, argsRecord(args));
  const clipped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(canonical)) {
    clipped[key] = typeof value === "string" && value.length > ARG_VALUE_CHARS ? `${value.slice(0, ARG_VALUE_CHARS)}…` : value;
  }
  const text = Object.keys(clipped).length ? redactText(stableStringify(clipped)) : "";
  return text.length > ARGS_CHARS ? `${text.slice(0, ARGS_CHARS)}…` : text;
}

const positiveInt = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;

/** The line window a `read_file` returned: its served offset and lines, else what it asked for. */
function readWindow(args: Record<string, unknown>, result: unknown): string {
  const data = asRecord(result);
  const start = positiveInt(data?.offset) ?? positiveInt(args.offset) ?? 1;
  const content = typeof data?.content === "string" ? data.content : undefined;
  const returned = content !== undefined ? (content === "" ? 0 : content.split("\n").length) : undefined;
  const end = returned !== undefined
    ? start + Math.max(returned, 1) - 1
    : start + (positiveInt(args.limit) ?? READ_DEFAULT_LINE_LIMIT) - 1;
  const total = positiveInt(data?.totalLines);
  return `${start}-${total !== undefined ? Math.min(end, total) : end}${total !== undefined ? ` of ${total}` : ""}`;
}

function windowList(windows: readonly string[]): string {
  if (windows.length <= MAX_WINDOWS_PER_LINE) return windows.join(", ");
  return `${windows.slice(0, MAX_WINDOWS_PER_LINE).join(", ")} (+${windows.length - MAX_WINDOWS_PER_LINE} more windows)`;
}

/**
 * One line per distinct call, in first-seen order: every `read_file` of a path folded into
 * one line with its windows (a window read twice is listed once), every other data call
 * once per distinct argument set.
 */
function callLines(trace: readonly CoverageStep[]): string[] {
  const order: string[] = [];
  const reads = new Map<string, string[]>();
  const calls = new Set<string>();
  for (const step of trace) {
    if (!isDataCall(step)) continue;
    if (step.label === "read_file") {
      const args = canonicalReadArgs(step.label, argsRecord(step.args));
      const path = typeof args.path === "string" ? redactText(args.path) : "";
      if (!path) continue;
      const key = `read_file ${path}`;
      const windows = reads.get(key);
      const window = readWindow(args, step.result);
      if (!windows) {
        reads.set(key, [window]);
        order.push(key);
      } else if (!windows.includes(window)) windows.push(window);
      continue;
    }
    const args = compactArgs(step.label, step.args);
    const line = args ? `${step.label} ${args}` : step.label;
    if (calls.has(line)) continue;
    calls.add(line);
    order.push(line);
  }
  return order.map((key) => {
    const windows = reads.get(key);
    return windows ? `${key} lines ${windowList(windows)}` : key;
  });
}

/** owner → child: the calls the owner already made, for `ownerHandoffBlock`'s `established`. */
export function establishedCalls(ownerTrace: readonly CoverageStep[]): string[] {
  return callLines(ownerTrace);
}

/** The budget of a report's coverage lines — what is left of the report is the child's own answer. */
export const COVERAGE_CHARS = 1_500;

/**
 * child → owner: what the child read, within {@link COVERAGE_CHARS} (`- ` and newline per
 * line included) — the data file holds every call regardless.
 */
export function coverageOf(childTrace: readonly CoverageStep[], maxChars: number = COVERAGE_CHARS): string[] {
  const lines = callLines(childTrace);
  const out: string[] = [];
  let used = 0;
  for (const [i, line] of lines.entries()) {
    const rest = lines.length - i - 1;
    const tail = rest > 0 ? `… and ${rest} more (every call is in the collected-data file)`.length + 3 : 0;
    if (used + line.length + 3 + tail > maxChars) {
      out.push(`… and ${lines.length - i} more (every call is in the collected-data file)`);
      return out;
    }
    out.push(line);
    used += line.length + 3;
  }
  return out;
}

/** The characters a coverage list takes in a report (`childReportText` renders `- line`). */
export function coverageChars(coverage: readonly string[]): number {
  return coverage.reduce((n, line) => n + line.length + 3, 0);
}

function resultText(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 1) ?? "";
  } catch {
    return String(result);
  }
}

/**
 * child → owner: every data call the child made and the full result it got back, as one
 * Markdown document the owner pages with `read_file`, secrets redacted. Empty when the
 * child collected nothing — then no file is written.
 */
export function collectedDataText(childTrace: readonly CoverageStep[], heading: string): string {
  const sections: string[] = [];
  let used = 0;
  let index = 0;
  for (const step of childTrace) {
    if (!isDataCall(step)) continue;
    index += 1;
    const args = compactArgs(step.label, step.args);
    const section = `## ${index}. ${step.label}${args ? ` ${args}` : ""}\n\n${redactText(resultText(step.result))}\n`;
    if (used + section.length > COLLECTED_DATA_CHARS) {
      sections.push(`## … the remaining calls were left out (the file is capped at ${COLLECTED_DATA_CHARS} chars)\n`);
      break;
    }
    sections.push(section);
    used += section.length;
  }
  if (!sections.length) return "";
  const note = "_The run keeps its last 500 trace events, so a long run's earliest calls may be missing here._";
  return `# ${heading}\n\n${note}\n\n${sections.join("\n")}`;
}
