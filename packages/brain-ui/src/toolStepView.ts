/**
 * How ONE tool step presents itself — pure, framework-free, and shared by every
 * surface that mounts the transcript (the web Brain panel, the Canvas dock, the
 * VS Code webview).
 *
 * The transcript used to render every step the same way: the tool's name, then its
 * arguments as raw JSON and its result as raw JSON, both folded away behind a caret.
 * For a SHELL step that is the least readable form of the two things a reader
 * actually wants — the command that ran, and what it printed. `{"command":"pnpm -w
 * test"}` above `{"ok":true,"exitCode":0,"stdout":"…"}` is a transcript of the
 * transport, not of the work; every other agent chat shows the command and its
 * terminal output, because that is what you check when you want to know whether the
 * agent really ran the build.
 *
 * So a command-shaped call gets a {@link CommandRun}: the command on its own line and
 * the combined stdout/stderr as terminal text, with the exit code called out when it
 * is non-zero. Detection is STRUCTURAL (an argument named `command`, a result shaped
 * like a shell result) rather than a list of tool names, so it covers `run_command`,
 * a gateway MCP shell tool and any future one without an allow-list to maintain.
 *
 * Nothing is ever hidden to achieve this: the raw argument JSON is still rendered for
 * whatever the command line did not already show, and the raw result JSON is dropped
 * ONLY when every field in it is one the terminal panel already displays.
 */

import { activityTarget } from '@seanhogg/builderforce-brain-embedded';
import { formatPayload } from './timelineModel';

/** A change an edit_file / write_file call carries in its own arguments. */
export type ToolPreview =
  | { kind: 'edit'; path: string; oldText: string; newText: string }
  | { kind: 'write'; path: string; content: string };

/** A shell step, presented as a terminal exchange rather than as two JSON blobs. */
export interface CommandRun {
  /** The command line that ran. */
  command: string;
  /** Combined stdout/stderr (plus any error text), trailing blank lines trimmed. */
  output: string;
  /** The process exit code when the result reported one. */
  exitCode: number | null;
  /** Whether the call succeeded, from the result's own `ok`, else from the exit code. */
  ok: boolean;
  /** True when {@link output} already carries everything the raw result JSON would —
   *  the only case in which it is safe to stop rendering that JSON as well. */
  outputComplete: boolean;
}

/** Everything a tool step renders, decided once so the renderer only lays it out. */
export interface ToolStepView {
  /** The concrete thing the call was about, for the collapsed header line. */
  subject: string | null;
  command: CommandRun | null;
  preview: ToolPreview | null;
  /** Raw argument JSON, minus anything the command line already shows. `''` = omit. */
  argsText: string;
  /** Raw result JSON. `''` = the terminal panel already shows all of it. */
  resultText: string;
  /** Whether the step opens expanded: a command and a failure both exist to be read. */
  defaultOpen: boolean;
}

/** Argument names that carry a shell command line, in priority order. */
const COMMAND_KEYS = ['command', 'cmd'] as const;

/**
 * Result fields a {@link CommandRun} already renders. A result carrying ONLY these is
 * fully described by the terminal panel; one carrying anything else keeps its raw JSON
 * so no field is silently dropped.
 */
const SHELL_RESULT_KEYS = new Set([
  'ok', 'stdout', 'stderr', 'output', 'exitCode', 'exit_code', 'error', 'truncated',
  'command', 'durationMs', 'signal', 'timedOut',
]);

/** Result fields whose text is shown, in the order a terminal would have printed them. */
const SHELL_TEXT_KEYS = ['stdout', 'output', 'stderr', 'error'] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Drop trailing blank lines so a command card doesn't end in dead space. */
function trimTrailingBlank(text: string): string {
  return text.replace(/\s+$/, '');
}

/**
 * The shell command a call ran, or null when it isn't a command-shaped call. Detected
 * from the ARGUMENTS, so it holds for any tool that takes a command line.
 */
export function commandOf(args: unknown): string | null {
  const record = asRecord(args);
  if (!record) return null;
  for (const key of COMMAND_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * A tool result may arrive as an object or as the JSON string a host's `execute`
 * returned. Both are the same result; only one of them is readable.
 */
function shellResultRecord(result: unknown): Record<string, unknown> | null {
  const direct = asRecord(result);
  if (direct) return direct;
  if (typeof result === 'string') {
    const text = result.trim();
    if (text.startsWith('{')) {
      try {
        return asRecord(JSON.parse(text));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function numberAt(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Read a shell result into the terminal half of a {@link CommandRun}. A result that is
 * a bare string is taken as its output verbatim — that IS the whole result.
 */
export function shellOutcomeOf(result: unknown): Omit<CommandRun, 'command'> {
  if (result == null) return { output: '', exitCode: null, ok: true, outputComplete: true };
  const record = shellResultRecord(result);
  if (!record) {
    const text = typeof result === 'string' ? result : formatPayload(result);
    return { output: trimTrailingBlank(text), exitCode: null, ok: true, outputComplete: typeof result === 'string' };
  }
  const parts: string[] = [];
  for (const key of SHELL_TEXT_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) parts.push(value);
  }
  const exitCode = numberAt(record, 'exitCode') ?? numberAt(record, 'exit_code');
  const ok = typeof record.ok === 'boolean' ? record.ok : exitCode == null ? true : exitCode === 0;
  const outputComplete = Object.keys(record).every((key) => SHELL_RESULT_KEYS.has(key));
  return { output: trimTrailingBlank(parts.join('\n')), exitCode, ok, outputComplete };
}

/** An edit_file / write_file tool call carries the change itself in its args, so we
 *  can render a readable preview (a before/after diff for edits, the new content for
 *  writes) instead of only the raw JSON — detected structurally so it works regardless
 *  of the tool's display label. */
export function toolPreview(args: unknown): ToolPreview | null {
  const a = asRecord(args);
  if (!a) return null;
  const path = typeof a.path === 'string' ? a.path : '';
  if (typeof a.old_string === 'string' && typeof a.new_string === 'string') {
    return { kind: 'edit', path, oldText: a.old_string, newText: a.new_string };
  }
  if (path && typeof a.content === 'string') {
    return { kind: 'write', path, content: a.content };
  }
  return null;
}

/**
 * The arguments a command card does NOT already show. A `run_command` call whose only
 * argument is the command renders no Input panel at all; one that also carried a
 * working directory or a timeout still shows those, because dropping them would hide
 * part of what actually ran.
 */
function residualArgs(args: unknown, command: string | null): unknown {
  if (!command) return args;
  const record = asRecord(args);
  if (!record) return args;
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!(COMMAND_KEYS as readonly string[]).includes(key)) rest[key] = value;
  }
  return Object.keys(rest).length > 0 ? rest : null;
}

/** Decide how one tool step presents itself. */
export function toolStepView({ args, result, isError }: { args: unknown; result: unknown; isError: boolean }): ToolStepView {
  const commandLine = commandOf(args);
  const command: CommandRun | null = commandLine ? { command: commandLine, ...shellOutcomeOf(result) } : null;
  return {
    subject: activityTarget(args) ?? null,
    command,
    preview: toolPreview(args),
    argsText: formatPayload(residualArgs(args, commandLine)),
    resultText: command?.outputComplete ? '' : formatPayload(result),
    // A command is the step a reader opens the transcript to check, and a failure is
    // the step they need to read at all — neither should cost a click to see.
    defaultOpen: !!command || isError,
  };
}
