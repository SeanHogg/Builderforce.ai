/**
 * Client-first server routes (PRD 42 · Part D1) — the ONE client helper.
 *
 * A route that spends a server model call on the user's own content (a summary, a rewrite,
 * a judgement) first asks the device. A result rides the request as `clientResult` with a
 * provenance stamp, and the server validates and stores it instead of calling a model. When
 * the device declines (`null`) the request is sent exactly as it was before. When the server
 * rejects the result (`400 invalid_client_result`), the request is sent once more WITHOUT it.
 *
 * Nothing here names a host, a browser API or a transport: the host supplies the port and
 * its provenance, the caller supplies how to send.
 */

import { builtInModelIdentity } from '../builtInAi/identity';
import { reportOnDeviceFailure } from './onDeviceFailure';
import type { OnDeviceObserver, OnDeviceTasks, ServedBy } from './onDeviceTasks';

export type ClientResultEngine = 'browser' | 'bfi' | 'webllm' | 'synapse';

/** Who produced a client result — the server whitelists the engine and stores both. */
export interface ClientResultProvenance {
  engine: ClientResultEngine;
  model: string;
}

/** The `clientResult` request field (the fixed server contract). */
export interface ClientResultPayload {
  text?: string;
  json?: unknown;
  provenance: ClientResultProvenance;
}

/**
 * A host's on-device port and the stamp its results carry.
 *
 * `tasks` must NOT be an observing port (one built with an `observe` sink): an accepted
 * client result is metered by the SERVER's row, so a call this host also counted locally
 * would be double-counted. A client-first host wires `observe` only here, below, where it
 * reports `replaced` when the server refuses a result.
 */
export interface ClientFirstHost {
  tasks: OnDeviceTasks;
  /** The stamp for a result whose serving engine is unknown (a host that does not trace calls). */
  provenance(): ClientResultProvenance;
  /** The host's measuring sink (PRD 42 · Part F): told `replaced` when the server refuses a result. */
  observe?: OnDeviceObserver;
}

/**
 * What a payload remembers about its own call, off the wire: a symbol key is skipped by
 * `JSON.stringify`, so the server never sees it. Per payload, so concurrent calls cannot cross.
 */
const TRACE = Symbol('clientResultTrace');
interface Trace { by: ServedBy; observe: OnDeviceObserver | undefined }
type Traced = ClientResultPayload & { [TRACE]?: Trace };

/** The ClientResultEngine a serving engine is stamped as; `ollama` / `freetoken` are not on the server's whitelist, so the host's own stamp stands. */
const STAMPABLE: ReadonlySet<string> = new Set<ClientResultEngine>(['browser', 'bfi', 'webllm', 'synapse']);

function stamped(host: Pick<ClientFirstHost, 'provenance' | 'observe'>, served: ServedBy | undefined, payload: Omit<ClientResultPayload, 'provenance'>): ClientResultPayload {
  const provenance: ClientResultProvenance = served && STAMPABLE.has(served.engine)
    ? { engine: served.engine as ClientResultEngine, model: served.model }
    : host.provenance();
  const result: Traced = { ...payload, provenance };
  if (served) Object.defineProperty(result, TRACE, { value: { by: served, observe: host.observe } satisfies Trace, enumerable: false });
  return result;
}

/**
 * A per-request capture of who served a call: hand `onServed` to the port's calls, read `served()`
 * when stamping the result. Local to ONE request (never module state), so concurrent requests
 * cannot cross; with several calls (chunks) the last server wins.
 */
export function capturingServed(): { onServed(by: ServedBy): void; served(): ServedBy | undefined } {
  let last: ServedBy | undefined;
  return { onServed: (by) => { last = by; }, served: () => last };
}

/**
 * A text result, or `null` when the device declined or produced nothing. `served` is who
 * answered THIS call (the port's `onServed`); it sets the provenance stamp.
 */
export function textClientResult(text: string | null, host: Pick<ClientFirstHost, 'provenance' | 'observe'>, served?: ServedBy): ClientResultPayload | null {
  return text !== null && text.trim() ? stamped(host, served, { text }) : null;
}

/** A structured result, or `null` when the device declined. */
export function jsonClientResult(json: unknown, host: Pick<ClientFirstHost, 'provenance' | 'observe'>, served?: ServedBy): ClientResultPayload | null {
  return json === null || json === undefined ? null : stamped(host, served, { json });
}

/** True when a failed request is the server rejecting `clientResult` (HTTP 400 `invalid_client_result`). */
export function isInvalidClientResult(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { status?: unknown; statusCode?: unknown; code?: unknown; error?: unknown; message?: unknown; body?: unknown };
  const status = e.status ?? e.statusCode;
  if (status !== undefined && status !== 400) return false;
  const body = typeof e.body === 'object' && e.body !== null ? (e.body as { error?: unknown }).error : undefined;
  const marks = [e.code, e.error, body, e.message];
  return marks.some((m) => typeof m === 'string' && m.includes('invalid_client_result'));
}

/** The device answered and the server refused it: the cloud redoes the call (Part F's `replaced`). */
function reportReplaced(payload: ClientResultPayload): void {
  const trace = (payload as Traced)[TRACE];
  if (!trace?.observe) return;
  try {
    trace.observe({ kind: trace.by.kind, engine: trace.by.engine, model: trace.by.model, outcome: 'replaced', ms: 0 });
  } catch (e) {
    reportOnDeviceFailure('observe', e); // an observer never fails a request
  }
}

/**
 * Try the device, send with its result, and retry once without it when the server refuses it.
 * `produce` may only throw an abort; any other failure of `produce` is treated as a decline.
 */
export async function withClientResult<T>(
  produce: () => Promise<ClientResultPayload | null>,
  send: (clientResult?: ClientResultPayload) => Promise<T>,
): Promise<T> {
  let clientResult: ClientResultPayload | null = null;
  try {
    clientResult = await produce();
  } catch (error) {
    if ((error as { name?: string } | null)?.name === 'AbortError') throw error;
  }
  if (!clientResult) return send();
  try {
    return await send(clientResult);
  } catch (error) {
    if (isInvalidClientResult(error)) {
      reportReplaced(clientResult);
      return send();
    }
    throw error;
  }
}

/**
 * A page host's (web, Rovr) client-first pair over its `OnDeviceTasks`. A result is stamped by
 * whoever served that call (`textClientResult(…, served)`); the `browser` + built-in model stamp
 * is only the fallback for a result with no trace.
 */
export function pageClientFirst(tasks: OnDeviceTasks, observe?: OnDeviceObserver): ClientFirstHost {
  return { tasks, provenance: () => ({ engine: 'browser', model: builtInModelIdentity().model }), ...(observe ? { observe } : {}) };
}
