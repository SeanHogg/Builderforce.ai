/**
 * The HTTP half of `clientResult` (PRD 42 Part D): every D2 route admits the field the
 * same way — absent ⇒ run as before; invalid ⇒ 400 `{ error: 'invalid_client_result',
 * reason }` (the client then retries WITHOUT it); valid ⇒ hand the use case the value.
 * Parsing and validation live in `application/llm/clientResult.ts`; this only maps the
 * outcome to a response so no route repeats it.
 */
import type { Context } from 'hono';
import type { HonoEnv } from '../../env';
import {
  readClientResult,
  type ClientResultSpec,
  type ClientSupplied,
} from '../../application/llm/clientResult';
import { parseOptionalBody, z } from './requestBody';

/** For a route with no body schema of its own (the Brain summarize routes). */
export const ClientResultBody = z.object({ clientResult: z.unknown().optional() });

export type ClientResultAdmission<T> = { client?: ClientSupplied<T>; rejection?: Response };

/** Admit an already-extracted `clientResult` value against `spec`. */
export function admitClientResult(c: Context<HonoEnv>, raw: unknown, spec: { kind: 'text'; maxChars: number }): ClientResultAdmission<string>;
export function admitClientResult<T>(c: Context<HonoEnv>, raw: unknown, spec: { kind: 'json'; validate: (v: unknown) => v is T }): ClientResultAdmission<T>;
export function admitClientResult<T>(c: Context<HonoEnv>, raw: unknown, spec: ClientResultSpec<T>): ClientResultAdmission<string | T> {
  const parsed = spec.kind === 'text' ? readClientResult(raw, spec) : readClientResult(raw, spec);
  if (!parsed) return {};
  if (!parsed.ok) return { rejection: c.json({ error: 'invalid_client_result', reason: parsed.reason }, 400) };
  return { client: { value: parsed.value, provenance: parsed.provenance } };
}

/**
 * A client-supplied draft answered in the shape the streamed `/ai/draft` consumer already
 * parses (OpenAI-compatible SSE): ONE content delta, then `[DONE]`.
 */
export function clientTextAsSseResponse(text: string): Response {
  const frame = (data: string) => `data: ${data}\n\n`;
  const body = frame(JSON.stringify({ choices: [{ delta: { content: text } }] })) + frame('[DONE]');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' } });
}

/** As {@link admitClientResult}, reading the (optional) JSON body itself. */
export async function admitBodyClientResult(c: Context<HonoEnv>, spec: { kind: 'text'; maxChars: number }): Promise<ClientResultAdmission<string>> {
  const body = await parseOptionalBody(c, ClientResultBody);
  return admitClientResult(c, body.clientResult, spec);
}
