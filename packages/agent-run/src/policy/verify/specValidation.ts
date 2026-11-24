import { classifyRequest } from "@builderforce/agent-stall";
import { executableTokensOf, runsCheck, shellCommandOf } from "@builderforce/run-guards";
import type { RunState, RunTask } from "../../contract.js";
import type { PolicyToolCall } from "../hooks.js";

interface Check {
  command: string;
  cwd?: string;
}

export interface SpecValidationState {
  prompted?: true;
  target?: string;
  readTarget?: true;
  root?: string;
  required?: Check[];
  pending?: Record<string, Check>;
  completed?: Array<Check & { exitCode: number }>;
}

export function planSpecValidation(task: RunTask): SpecValidationState | undefined {
  const { ask } = classifyRequest(task.request ?? task.prompt);
  if (/^\s*(?:how|why|when|where|what)\b/i.test(ask)
      || /\b(?:do not|don't|never)\s+(?:validate|verify|revalidate|re-validate)\b/i.test(ask)) return undefined;
  if (!/\b(?:validate|verify|revalidate|re-validate)\b[^!?\r\n]{0,200}\b(?:prd|spec(?:ification)?s?)\b/i.test(ask)
      && !/(?:^|[\n.!?])\s*(?:please\s+)?(?:prds?|spec(?:ification)?s?)\b[^.!?\r\n]{0,100}\bvalidation\b/i.test(ask)) return undefined;
  const target = /\b[\w-]*(?:prd|spec)[\w.-]*\.md\b/i.exec(ask)?.[0].toLowerCase();
  return target ? { target } : {};
}

function checkCommand(command: string): boolean {
  // A single command gives the exit code an unambiguous owner.
  if (/[|;&<>\r\n]/.test(command)) return false;
  const [exe, script] = executableTokensOf(command);
  return runsCheck(command) || ((exe === "node" || exe === "tsx") && /^\.?[\\/]?scripts[\\/]check-[\w.-]+\.[cm]?[jt]s$/.test(script ?? ""));
}

function record(validation: SpecValidationState, check: Check, exitCode: number): void {
  const checks = validation.completed ?? [];
  validation.completed = [
    ...checks.filter((item) => item.command !== check.command || item.cwd !== check.cwd),
    { ...check, exitCode },
  ].slice(-24);
}

function readAcceptanceChecks(validation: SpecValidationState, path: unknown, content: unknown): void {
  if (typeof path !== "string" || typeof content !== "string") return;
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase();
  if (validation.target && name !== validation.target) return;
  if (validation.target) validation.readTarget = true;
  if (validation.required) return;
  const manifest = /(?:^|\n)```builderforce-acceptance[^\S\n]*\r?\n([\s\S]*?)\r?\n```/.exec(content.slice(0, 12_000));
  if (!manifest) return;
  try {
    const rows: unknown = JSON.parse(manifest[1]!);
    if (!Array.isArray(rows) || rows.length > 24) return;
    const checks = rows.filter((row): row is Check =>
      row && typeof row.command === "string" && checkCommand(row.command)
      && typeof row.cwd === "string" && row.cwd.length <= 300);
    if (checks.length && checks.length === rows.length) {
      validation.required = checks;
      validation.root = /^(.*)[\\/]docs[\\/]specs[\\/]/i.exec(path)?.[1];
    }
  } catch {
    // The report can still describe manually executed checks for older or malformed specs.
  }
}

function missingChecks(state: RunState): readonly Check[] {
  const validation = state.specValidation;
  const normalize = (path: string) => path.replace(/\\/g, "/").replace(/^(?:\.\/)+|\/$/g, "");
  return (validation?.required ?? []).filter((required) => !validation?.completed?.some((actual) => {
    if (actual.command.trim().replace(/\s+/g, " ") !== required.command.trim().replace(/\s+/g, " ")) return false;
    const cwd = normalize(actual.cwd ?? ".");
    const directory = normalize(required.cwd ?? ".");
    const root = normalize(validation.root ?? "").split("/").at(-1);
    const rooted = root ? (directory === "." ? root : `${root}/${directory}`) : "";
    return cwd === directory || (rooted !== "" && (cwd === rooted || cwd.endsWith(`/${rooted}`)));
  }));
}

function resultRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { value = JSON.parse(value) as unknown; } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Called only for actual, uncached dispatches after the authorization path. */
export function observeSpecCheck(state: RunState, call: PolicyToolCall, value: unknown, details: unknown, succeeded: boolean): void {
  const validation = state.specValidation;
  if (!validation) return;
  const result = resultRecord(value);
  const meta = resultRecord(details);
  if (call.name === "read_file" && succeeded) {
    readAcceptanceChecks(validation, result.path ?? call.args.path, result.content);
    return;
  }
  if (result.aborted || result.timedOut) return;
  if (call.name === "run_checks" && result.ran === true && typeof result.ok === "boolean") {
    record(validation, { command: "run_checks (host static checks / CI)" }, result.ok && succeeded ? 0 : 1);
    return;
  }
  const id = typeof result.id === "string" ? result.id : undefined;
  if (call.name === "command_status") {
    const requested = typeof call.args.id === "string" ? call.args.id.trim() : "";
    const pending = validation.pending;
    if (!pending || requested !== id || !Object.hasOwn(pending, requested)) return;
    const check = pending[requested]!;
    const exit = result.exitCode;
    if (result.status === "exited" && typeof exit === "number" && Number.isInteger(exit) && (succeeded || exit !== 0)) {
      record(validation, check, exit);
    }
    if (result.status === "exited" || result.status === "killed" || result.status === "unknown") delete pending[requested];
    return;
  }
  if (call.name !== "run_command") return;
  const command = shellCommandOf(call.args).trim();
  if (!checkCommand(command)) return;
  const cwd = call.args.cwd ?? result.cwd;
  const check = { command, ...(typeof cwd === "string" ? { cwd } : {}) };
  const exit = result.exitCode ?? meta.exitCode;
  if (typeof exit === "number" && Number.isInteger(exit) && (succeeded || exit !== 0)) {
    record(validation, check, exit);
  } else if (succeeded && id && result.status === "running") {
    validation.pending = Object.fromEntries([...Object.entries(validation.pending ?? {}), [id, check]].slice(-24));
  }
}

const INSTRUCTIONS = "For this PRD/spec validation, read its acceptance criteria and execute the named suites and repository guards through authorized tools. Run each check as a separate command in its package directory and wait for its exit result. Map each claim to its observed result. Label each missing or blocked check unverified, report failures, and never turn a source search, a started job, or a static check into a passing runtime test.";

export function specValidationSection(state: RunState): string | undefined {
  const validation = state.specValidation;
  if (!validation) return undefined;
  const evidence = validation.completed?.map(({ command, cwd, exitCode }) =>
    `- ${command}${cwd ? ` (cwd: ${cwd})` : ""} exited ${exitCode}`);
  const missing = missingChecks(state);
  return [
    INSTRUCTIONS,
    ...(validation.target && !validation.readTarget ? [`Read the named specification ${validation.target} before reporting a verdict.`] : []),
    evidence?.length ? "Completed checks for this run:" : "No executable check has completed in this run.",
    ...(evidence ?? []),
    ...(missing.length ? ["Declared acceptance checks still unverified:", ...missing.map(({ command, cwd }) => `- ${command} (cwd: ${cwd})`)] : []),
  ].join("\n");
}

export function missingSpecEvidence(state: RunState): boolean {
  const validation = state.specValidation;
  return !!validation && (!validation.completed?.length || (!!validation.target && !validation.readTarget) || missingChecks(state).length > 0);
}

export function specUnverifiedReason(state: RunState): string {
  const validation = state.specValidation;
  if (validation?.target && !validation.readTarget) return `PRD validation is unverified because ${validation.target} was not read.`;
  const missing = missingChecks(state).length;
  return missing
    ? `PRD validation is unverified because ${missing} declared acceptance check(s) did not complete.`
    : "PRD validation is unverified because no executable acceptance check completed.";
}

export function specValidationRetry(state: RunState): string | null {
  const validation = state.specValidation;
  if (!validation || !missingSpecEvidence(state)) return null;
  const reason = specUnverifiedReason(state);
  if (validation.prompted) return reason;
  validation.prompted = true;
  return `${reason} ${INSTRUCTIONS} If the host cannot execute the checks, explain the blocker.`;
}

export function unverifiedSpecCheckCount(state: RunState): number {
  return missingChecks(state).length;
}
