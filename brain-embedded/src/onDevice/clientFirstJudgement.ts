/**
 * The knowledge judge, client-first (PRD 42 · D2): `POST …/knowledge/judge` carries the
 * device's own judgement as `clientResult.json`.
 *
 * It runs the SAME core the server runs — agent-tools' `judgeWith`, so the prompts, the
 * per-item bounds and the validators are shared — with `OnDeviceTasks.json` as the `ask`.
 * If the device declines ANY question the whole request is left to the server (`null`):
 * a half-judged batch would be stored as if it were complete.
 */

import { judgeWith } from '@builderforce/agent-tools';
import type { JudgementRequest } from '@seanhogg/builderforce-memory/knowledge';
import { capturingServed, jsonClientResult, withClientResult, type ClientFirstHost, type ClientResultPayload } from './clientFirst';
import type { JsonSchema } from './onDeviceTasks';

/** The reply shape per question — the server re-validates items with the memory validators. */
export const JUDGEMENT_SCHEMAS: Readonly<Record<'extract' | 'compare', JsonSchema>> = {
  extract: { type: 'object', required: ['extract'], properties: { extract: { type: 'array' } } },
  compare: { type: 'object', required: ['compare'], properties: { compare: { type: 'array' } } },
};

/** The device's judgement of `req` as a `clientResult`, or `null` to use the server. */
export async function onDeviceJudgement(
  host: ClientFirstHost,
  req: Pick<JudgementRequest, 'kind' | 'items'> & { signal?: AbortSignal },
): Promise<ClientResultPayload | null> {
  if (!(await host.tasks.available()).has('json')) return null;
  const schema = JUDGEMENT_SCHEMAS[req.kind === 'compare' ? 'compare' : 'extract'];
  let declined = false;
  const capture = capturingServed();
  const result = await judgeWith(async (system, payload) => {
    if (declined) return undefined; // already leaving this request to the server
    const out = await host.tasks.json<unknown>({
      system, user: JSON.stringify(payload), schema, onServed: capture.onServed, ...(req.signal ? { signal: req.signal } : {}),
    });
    if (out === null) declined = true;
    return out ?? undefined;
  }, req as JudgementRequest);
  return declined ? null : jsonClientResult(result, host, capture.served());
}

/**
 * The knowledge client's `judgeClientFirst` option for a host (web, Rovr): the device judges
 * first, `send` carries the result, and a refused result is re-sent without it.
 */
export function judgeClientFirstFor(host: ClientFirstHost) {
  return <R>(req: Pick<JudgementRequest, 'kind' | 'items'> & { signal?: AbortSignal }, send: (clientResult?: ClientResultPayload) => Promise<R>): Promise<R> =>
    withClientResult(() => onDeviceJudgement(host, req), send);
}
