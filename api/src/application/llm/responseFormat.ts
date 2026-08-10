/**
 * Response-format conformance.
 *
 * Carved out of LlmProxyService, which had grown to 3,240 lines and 77 exports —
 * the largest module in the application layer and the one most call sites depend
 * on. This is a self-contained concern: given a request's `response_format` and a
 * model's reply, decide whether the reply conforms well enough to accept or whether
 * the failover chain should retry.
 *
 * It has ONE dependency on the parent (the request type), so it splits cleanly.
 * `LlmProxyService` re-exports everything here, so no caller changed.
 */

import type { ChatCompletionRequest } from './LlmProxyService';
import { validateJsonSchema } from './jsonSchemaValidator';

// ─────────────────────────────────────────────────────────────────────────────
// Response-format conformance — used by dispatchJson to detect non-conforming
// model output (broken JSON, missing required fields) and retry across the
// failover chain. Returns null when the response conforms (or no constraint
// was requested), or a short reason string when retry is warranted.
//
// This is a deliberately *minimal* validator. Full JSON-Schema validation
// is out of scope here — we don't want a runtime dependency. The two checks
// catch the most common failure modes:
//   1. `response_format: { type: 'json_object' }` — content doesn't parse.
//   2. `response_format: { type: 'json_schema', json_schema: { strict: true,
//      schema: { required: [...] } } }` — content parses but is missing a
//      top-level required field.
// ─────────────────────────────────────────────────────────────────────────────

function extractAssistantContent(raw: unknown): string | null {
  const choices = (raw as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices;
  const content = choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : null;
}

export function checkResponseFormatConformance(body: ChatCompletionRequest, raw: unknown): string | null {
  const rf = (body as { response_format?: { type?: string; json_schema?: { strict?: boolean; schema?: unknown } } }).response_format;
  if (!rf || (rf.type !== 'json_object' && rf.type !== 'json_schema')) return null;

  const content = extractAssistantContent(raw);
  if (content === null) return null; // Tool-call assistant turns legitimately have no content.

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return 'content is not valid JSON';
  }

  // Full draft-07-subset validation when strict json_schema is requested.
  // Catches nested type / enum / required / additionalProperties violations
  // that the consumer's downstream Zod (or equivalent) would otherwise
  // bounce back as a 4xx — letting the gateway retry the chain instead.
  if (rf.type === 'json_schema' && rf.json_schema?.strict === true && rf.json_schema.schema) {
    const errs = validateJsonSchema(parsed, rf.json_schema.schema, { maxErrors: 5 });
    if (errs.length > 0) {
      const summary = errs.map((e) => `${e.path || '<root>'}: ${e.message}`).join('; ');
      return `schema mismatch (${errs.length}${errs.length >= 5 ? '+' : ''} errors): ${summary}`;
    }
  }

  return null;
}
