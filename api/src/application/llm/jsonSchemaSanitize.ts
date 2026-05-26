/**
 * Vendor-aware JSON-Schema keyword stripping for `response_format: { type:
 * 'json_schema', json_schema: { schema } }` pass-through.
 *
 * Background — why this exists:
 *   The gateway's contract with consumers is "vendor identity is invisible to
 *   route code." Consumers serialize a Zod schema with `z.toJSONSchema()` and
 *   send it as `response_format`. Zod's serializer emits draft-07-conforming
 *   keywords like `maxLength` / `minLength` / `format` / `pattern` on string
 *   types whenever the source schema used `.max(N)`, `.min(N)`, `.email()`,
 *   `.url()`, or `.regex(...)`. Most providers (OpenAI structured outputs,
 *   Google AI's OpenAI-compat surface, Anthropic) accept these. **Cerebras
 *   rejects them** — its strict JSON-Schema validator throws 400 with
 *   `"Invalid fields for schema with types ['string']: {'maxLength'}"`. The
 *   same constraint applies to `minimum` / `maximum` on number types, `format`
 *   on strings, and a handful of other draft-07 keywords.
 *
 * Why we strip for OpenRouter too:
 *   OpenRouter is a meta-vendor — it routes `qwen/qwen3-coder:free` and many
 *   other free-tier models to Cerebras as the upstream provider. From the
 *   gateway's perspective the call goes to OpenRouter; from Cerebras's
 *   validator's perspective the same 400 fires and OpenRouter wraps it as an
 *   embedded `{ error: { message: "[cerebras] 400: ..." } }`. Stripping the
 *   incompatible keywords on the OpenRouter path keeps Cerebras-backed free
 *   models in the cascade instead of immediately bouncing them.
 *
 *   For vendors whose stack we know accepts the full draft-07 set
 *   (`googleai`, NVIDIA NIM direct, Ollama Cloud, Anthropic direct via
 *   OpenRouter Pro pool), we still strip the *Cerebras-incompatible*
 *   keywords — the safest compatibility intersection is "strip everything
 *   that any upstream might reject." The cost is informational only: the
 *   model no longer sees `"a non-empty string up to 1000 chars"`, just
 *   `"a string"`. The gateway's `validateJsonSchema` still enforces the
 *   original constraints post-response, so the consumer's contract is
 *   preserved end-to-end.
 *
 * Why we don't strip selectively per backend route:
 *   OpenRouter's routing is opaque — they may switch a model from Cerebras
 *   to Groq to a self-hosted endpoint between requests. Branching on
 *   "current backend" would race against their internal failover. The
 *   intersection strategy is stable.
 *
 * Single source of truth:
 *   The stripped keyword set lives in `STRIPPED_KEYWORDS` below. Adding a
 *   vendor that's stricter than Cerebras = extend the set. Adding a vendor
 *   that's more permissive = no change (we still strip; the model just
 *   sees a slightly looser schema).
 */

/** Vendor ids whose strict-mode JSON-Schema validators reject draft-07
 *  keywords like `maxLength`. `openrouter` is included because it routes
 *  many free-tier model ids to Cerebras as the upstream provider, and the
 *  same 400 fires under the OpenRouter wrapper. */
const STRICT_VENDORS: ReadonlySet<string> = new Set(['cerebras', 'openrouter']);

/**
 * Keywords stripped from the schema before forwarding to a strict vendor.
 * These are the draft-07 keywords Zod's `toJSONSchema()` emits that
 * Cerebras's validator rejects with 400 (per the 2026-05 production trace
 * `llm-2cc6ba1b-...`). Conservative list — add more only when a real
 * upstream rejection is observed; over-stripping silently weakens the
 * schema delivered to the model.
 */
const STRIPPED_KEYWORDS: ReadonlySet<string> = new Set([
  // String constraints
  'maxLength',
  'minLength',
  'format',
  'pattern',
  // Number constraints
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  // Array constraints (Cerebras has been observed to reject these too)
  'minItems',
  'maxItems',
  'uniqueItems',
  // Annotations Cerebras's strict mode treats as unknown
  'default',
  'examples',
  'const',
]);

/** True when the vendor's strict-mode JSON-Schema validator rejects the
 *  draft-07 keywords listed in `STRIPPED_KEYWORDS`. */
export function vendorNeedsSchemaStrip(vendorId: string): boolean {
  return STRICT_VENDORS.has(vendorId);
}

/**
 * Deep-strip `STRIPPED_KEYWORDS` from a JSON-Schema tree. Pure / non-mutating —
 * returns a new object even when nothing was stripped, so the caller can hand
 * the result back to the vendor body without worrying about shared references.
 *
 * Walks `properties`, `items`, `additionalProperties` (schema form), `oneOf`,
 * `anyOf`, `allOf`. Other keywords are passed through verbatim.
 */
export function stripUnsupportedSchemaKeywords(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((s) => stripUnsupportedSchemaKeywords(s));
  }
  if (schema === null || typeof schema !== 'object') {
    return schema;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (STRIPPED_KEYWORDS.has(k)) continue;
    if (k === 'properties' && v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const subProps: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
        subProps[pk] = stripUnsupportedSchemaKeywords(pv);
      }
      out[k] = subProps;
    } else if (
      k === 'items'
      || k === 'additionalProperties'
      || k === 'oneOf'
      || k === 'anyOf'
      || k === 'allOf'
      || k === 'not'
    ) {
      out[k] = stripUnsupportedSchemaKeywords(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Vendor-aware passthrough for the `extraBody` blob each vendor module hands
 * to its HTTP transport. When the body contains a `response_format` with a
 * `json_schema.schema` payload and the vendor is in `STRICT_VENDORS`, strips
 * the incompatible keywords. Everything else is returned verbatim (same
 * object reference) so the call site can do
 *
 *   const safeExtra = sanitizeExtraBodyForVendor('cerebras', extraBody);
 *
 * unconditionally without an extra clone on the happy path.
 */
export function sanitizeExtraBodyForVendor(
  vendorId: string,
  extraBody: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!extraBody || !vendorNeedsSchemaStrip(vendorId)) return extraBody;

  const rf = extraBody['response_format'];
  if (!rf || typeof rf !== 'object') return extraBody;

  const rfObj = rf as Record<string, unknown>;
  const js = rfObj['json_schema'];
  if (!js || typeof js !== 'object') return extraBody;

  const jsObj = js as Record<string, unknown>;
  const inner = jsObj['schema'];
  if (!inner || typeof inner !== 'object') return extraBody;

  return {
    ...extraBody,
    response_format: {
      ...rfObj,
      json_schema: {
        ...jsObj,
        schema: stripUnsupportedSchemaKeywords(inner),
      },
    },
  };
}
