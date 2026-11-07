/**
 * clientResult — the ONE parser/validator for a model result the CLIENT already
 * produced on its own device (PRD 42 Part D, "client-first server routes").
 *
 * A D2 route's request body may carry
 *   `clientResult: { text?: string; json?: unknown; provenance: { engine, model } }`
 * and the route's use case then stores/returns it instead of spending a server model
 * call. The client is NOT trusted: a length cap (text), the caller's own validator
 * (json — the SAME validators the server applies to its own model output), and a
 * provenance whitelist all run here. No route parses `clientResult` inline.
 *
 * Only ever used for summaries, rewrites and judgements of the user's OWN content.
 * Grading and authorization routes must not call this (PRD 42 principle 6, done-check 8).
 */

/** The engines a client result may name — what can actually run on a device. */
export const CLIENT_RESULT_ENGINES = ['browser', 'bfi', 'webllm', 'synapse'] as const;
export type ClientResultEngine = (typeof CLIENT_RESULT_ENGINES)[number];

/** `llm_usage_log.model` is varchar(200); the contract is tighter. */
export const CLIENT_RESULT_MODEL_MAX = 128;

/** A summary / short rewrite (the server's own cap is ~800 completion tokens). */
export const CLIENT_SUMMARY_SPEC = { kind: 'text', maxChars: 8_000 } as const;
/** A drafted or rewritten document (an SOP). */
export const CLIENT_DOCUMENT_SPEC = { kind: 'text', maxChars: 60_000 } as const;

/** Cap on a structured reply's serialized size. */
export const CLIENT_JSON_MAX_CHARS = 100_000;
/**
 * A structured model reply as a JSON object. Only the envelope is checked here; the
 * use case then runs the reply through the SAME verifier it applies to its own model's
 * output (e.g. the résumé invented-number guard), so a bad entry is refused there.
 */
export const CLIENT_JSON_OBJECT_SPEC = {
  kind: 'json',
  validate: (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v) && JSON.stringify(v).length <= CLIENT_JSON_MAX_CHARS,
} as const;

export interface ClientResultProvenance {
  engine: ClientResultEngine;
  model: string;
}

export type ClientResultSpec<T> =
  | { kind: 'text'; maxChars: number }
  | { kind: 'json'; validate: (value: unknown) => value is T };

/** A validated client result: the value plus who produced it. */
export interface ClientSupplied<T> {
  value: T;
  provenance: ClientResultProvenance;
}

export type ParsedClientResult<T> =
  | ({ ok: true } & ClientSupplied<T>)
  | { ok: false; reason: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseProvenance(raw: unknown): ClientResultProvenance | string {
  if (!isRecord(raw)) return 'provenance_required';
  const { engine, model } = raw;
  if (typeof engine !== 'string' || !(CLIENT_RESULT_ENGINES as readonly string[]).includes(engine)) return 'provenance_engine_invalid';
  if (typeof model !== 'string' || model.trim() === '' || model.length > CLIENT_RESULT_MODEL_MAX) return 'provenance_model_invalid';
  return { engine: engine as ClientResultEngine, model };
}

export function parseClientResult(raw: unknown, spec: { kind: 'text'; maxChars: number }): ParsedClientResult<string>;
export function parseClientResult<T>(raw: unknown, spec: { kind: 'json'; validate: (value: unknown) => value is T }): ParsedClientResult<T>;
export function parseClientResult<T>(raw: unknown, spec: ClientResultSpec<T>): ParsedClientResult<string | T> {
  if (!isRecord(raw)) return { ok: false, reason: 'not_an_object' };
  const provenance = parseProvenance(raw.provenance);
  if (typeof provenance === 'string') return { ok: false, reason: provenance };

  if (spec.kind === 'text') {
    if (typeof raw.text !== 'string') return { ok: false, reason: 'text_required' };
    const text = raw.text.trim();
    if (!text) return { ok: false, reason: 'text_empty' };
    if (text.length > spec.maxChars) return { ok: false, reason: 'text_too_long' };
    return { ok: true, value: text, provenance };
  }

  if (raw.json === undefined) return { ok: false, reason: 'json_required' };
  if (!spec.validate(raw.json)) return { ok: false, reason: 'json_invalid' };
  return { ok: true, value: raw.json, provenance };
}

/**
 * The route-facing read: `null` when the body carries no `clientResult` (the route runs
 * exactly as before), else the parse outcome (a failure answers 400
 * `invalid_client_result`).
 */
export function readClientResult(raw: unknown, spec: { kind: 'text'; maxChars: number }): ParsedClientResult<string> | null;
export function readClientResult<T>(raw: unknown, spec: { kind: 'json'; validate: (value: unknown) => value is T }): ParsedClientResult<T> | null;
export function readClientResult<T>(raw: unknown, spec: ClientResultSpec<T>): ParsedClientResult<string | T> | null {
  if (raw === undefined || raw === null) return null;
  return spec.kind === 'text' ? parseClientResult(raw, spec) : parseClientResult(raw, spec);
}
