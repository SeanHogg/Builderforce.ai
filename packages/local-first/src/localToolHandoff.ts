/**
 * Local domain tool handoff (G06).
 *
 * A local tool call is appended to a local queue and later handed to sync.
 * It is never turned into a platform request, and this module does not import
 * a network client or record an arbitrary remote tool call as offline history.
 */

export const TOOL_NAME_REQUIRED = 'tool_name_required';

export const PLATFORM_TOOL_REFUSED = 'platform_tool_refused';

export type LocalToolHandoffStatus = 'queued' | 'handed_off';

export interface LocalToolCallInput {
  readonly id?: string;
  readonly name: string;
  readonly args?: Readonly<Record<string, unknown>>;
}

export interface QueuedLocalToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly status: LocalToolHandoffStatus;
}

function fail(code: string): never {
  throw Object.assign(new Error(code), { code });
}

function requireName(name: unknown): string {
  if (typeof name !== 'string' || name.trim() === '') fail(TOOL_NAME_REQUIRED);
  return name.trim();
}

function callId(id: string | undefined): string {
  if (typeof id === 'string' && id.trim() !== '') return id;
  return crypto.randomUUID();
}

function copyArgs(args: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, unknown>> {
  if (args == null || typeof args !== 'object' || Array.isArray(args)) return Object.freeze({});
  return Object.freeze({ ...args });
}

function queuedCall(call: LocalToolCallInput, name: string): QueuedLocalToolCall {
  return Object.freeze({
    id: callId(call.id),
    name,
    args: copyArgs(call.args),
    status: 'queued',
  });
}

/**
 * Append a local tool call to the queue. An empty name throws
 * tool_name_required before the queue is touched.
 */
export function enqueueLocalTool(queue: QueuedLocalToolCall[], call: LocalToolCallInput): QueuedLocalToolCall {
  const name = requireName(call?.name);
  const entry = queuedCall(call, name);
  queue.push(entry);
  return entry;
}

/**
 * Hand queued calls to sync. The returned calls are marked handed_off.
 * The original queue is left unchanged.
 */
export function handoff(queue: readonly QueuedLocalToolCall[]): readonly QueuedLocalToolCall[] {
  return Object.freeze(
    queue
      .filter((entry) => entry.status === 'queued')
      .map((entry) =>
        Object.freeze({
          id: entry.id,
          name: entry.name,
          args: copyArgs(entry.args),
          status: 'handed_off' as const,
        }),
      ),
  );
}

/**
 * A local tool call never becomes a platform request.
 */
export function refusesPlatform(_call: LocalToolCallInput | QueuedLocalToolCall): never {
  fail(PLATFORM_TOOL_REFUSED);
}
