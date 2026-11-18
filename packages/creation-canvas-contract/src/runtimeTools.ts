/**
 * The run loop's agent tools (PRD 31 §W1 item 8, §4.7 `runtime.*`) — ONE definition of
 * each tool, served by TWO executors behind the same name:
 * - the CONTAINER executor runs server-side (`api`: the built-in tool catalog), over the
 *   preview ingress, the run sandbox and Browser Rendering;
 * - the BROWSER executor runs client-side in the tab that holds the browser run
 *   (`frontend`: the browser agent loop), because a browser run lives in the user's tab.
 * Which executor answers is decided by where the app runs (the run-target registry),
 * never by the tool name. A server-side caller that reaches a browser-only run gets
 * {@link BROWSER_RUN_NOT_ATTACHED} — a clear answer, never a hang.
 */
import { CANVAS_VIEWPORTS } from './viewport';

export const RUNTIME_TOOL_IDS = [
  'runtime.preview_status',
  'runtime.preview_url',
  'runtime.preview_logs',
  'runtime.preview_restart',
  'runtime.preview_screenshot',
  'runtime.run_verify',
] as const;

export type RuntimeToolId = typeof RUNTIME_TOOL_IDS[number];

export interface RuntimeToolSpec {
  tool: RuntimeToolId;
  mutates: boolean;
  description: string;
  parameters: Record<string, unknown>;
}

/** The `code` a runtime tool answers with when the run is in a browser tab this caller cannot reach. */
export const BROWSER_RUN_NOT_ATTACHED = 'browser_run_not_attached';

/** Tail length `preview_logs` returns when the caller names none, and the most it returns. */
export const RUNTIME_LOG_LINES = { default: 80, max: 400 } as const;

const S = { type: 'string' } as const;
const N = { type: 'number' } as const;
const target = {
  projectId: { ...N, description: 'The project whose app is running.' },
  executionId: { ...N, description: 'The run holding a container preview, when there is one.' },
};
const service = { ...S, description: 'The service to act on (e.g. "web", "api"). Default: the first one that serves pages.' };
const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required });

export const RUNTIME_TOOLS: readonly RuntimeToolSpec[] = [
  {
    tool: 'runtime.preview_status',
    mutates: false,
    description:
      "Where the app is running (the user's browser or a cloud container), why the other target "
      + 'did not run it, and each service\'s state (starting, live, failed, stopped) with its last error.',
    parameters: obj(target, ['projectId']),
  },
  {
    tool: 'runtime.preview_url',
    mutates: false,
    description: 'The URL a browser loads to see one service of the running app.',
    parameters: obj({ ...target, serviceId: service }, ['projectId']),
  },
  {
    tool: 'runtime.preview_logs',
    mutates: false,
    description: "The tail of a service's dev-server output — read it after an edit to see a compile error or a crash.",
    parameters: obj({ ...target, serviceId: service, lines: { ...N, description: `Lines to return (default ${RUNTIME_LOG_LINES.default}, at most ${RUNTIME_LOG_LINES.max}).` } }, ['projectId']),
  },
  {
    tool: 'runtime.preview_restart',
    mutates: true,
    description: 'Restart one service of the running app (the others keep running) — after a change a hot reload cannot apply.',
    parameters: obj({ ...target, serviceId: service }, ['projectId']),
  },
  {
    tool: 'runtime.preview_screenshot',
    mutates: false,
    description: 'Capture what a service of the running app shows right now, as an image — confirm an edit landed as intended.',
    parameters: obj({ ...target, serviceId: service, viewport: { ...S, enum: [...CANVAS_VIEWPORTS], description: 'Default desktop.' } }, ['projectId']),
  },
  {
    tool: 'runtime.run_verify',
    // It runs commands in the app's environment: gated, confirmed and audited like a write.
    mutates: true,
    description:
      "Run the app's declared verify commands (type-check, tests) where the app runs, and report each command's exit code "
      + 'and output tail. `command` runs one command instead of the declared ones.',
    parameters: obj({ ...target, command: { ...S, description: 'One command to run instead of the declared verify commands.' } }, ['projectId']),
  },
];

/** The function-call name a model sees for a tool (dots are not allowed there). */
export function runtimeToolFunctionName(tool: RuntimeToolId): string {
  return tool.replace('.', '_');
}

/** The tool a function-call name stands for, or undefined. */
export function runtimeToolOfFunctionName(name: string): RuntimeToolId | undefined {
  return RUNTIME_TOOL_IDS.find((tool) => runtimeToolFunctionName(tool) === name);
}

/** Output kept per verify command, from the end (the failure is at the bottom). */
export const VERIFY_OUTPUT_TAIL_CHARS = 4000;
