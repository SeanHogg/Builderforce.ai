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
 * Metadata-driven (2026-06-21):
 *   The per-vendor strip set is no longer a hardcoded `STRICT_VENDORS` literal
 *   keyed by id. Each `VendorModule` may declare a `schemaDialect.stripKeywords`
 *   set; the sanitizer composes the strip set at call time from the resolved
 *   upstream's metadata (via `schemaStripKeywordsForVendor`). Adding a vendor
 *   that's stricter than Cerebras = give its module a `schemaDialect` with its
 *   own keyword list — NO edit to this helper. A vendor with no `schemaDialect`
 *   is permissive (strip nothing). `CEREBRAS_STRICT_KEYWORDS` below is the
 *   canonical set both `cerebrasModule` and `openRouterModule` attach (OpenRouter
 *   inherits it because it routes `:free` ids to Cerebras as upstream).
 *
 * Why we don't strip selectively per backend route:
 *   OpenRouter's routing is opaque — they may switch a model from Cerebras
 *   to Groq to a self-hosted endpoint between requests. Branching on
 *   "current backend" would race against their internal failover. The
 *   intersection strategy (strip the union of what any plausible upstream
 *   rejects) is stable.
 *
 * Single source of truth:
 *   `CEREBRAS_STRICT_KEYWORDS` is the canonical strip set. The registry maps
 *   a vendor id → its module's declared set; the sanitizer reads that map.
 */

/**
 * Canonical Cerebras strict-mode strip set. These are the draft-07 keywords
 * Zod's `toJSONSchema()` emits that Cerebras's validator rejects with 400 (per
 * the 2026-05 production trace `llm-2cc6ba1b-...`). Conservative list — add
 * more only when a real upstream rejection is observed; over-stripping silently
 * weakens the schema delivered to the model.
 *
 * Attached to BOTH `cerebrasModule` and `openRouterModule` as their
 * `schemaDialect.stripKeywords` (OpenRouter inherits it because it routes many
 * `:free` ids to Cerebras as the upstream provider).
 */
export const CEREBRAS_STRICT_KEYWORDS: readonly string[] = [
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
];

/**
 * Resolve the strip-keyword set for a vendor id from the registry's module
 * metadata. Returns an empty set for permissive vendors (no `schemaDialect`).
 *
 * Lives here (not in the registry) but the registry injects the lookup at
 * import time via `registerSchemaDialectResolver` to avoid a circular import
 * (`vendors/registry` → `vendors/*` modules → `jsonSchemaSanitize`).
 */
type SchemaDialectResolver = (vendorId: string) => readonly string[];

let dialectResolver: SchemaDialectResolver = () => [];

/** Registry calls this once at module-init to wire the vendor → strip-set map.
 *  Keeps the sanitizer metadata-driven without a circular import. */
export function registerSchemaDialectResolver(resolver: SchemaDialectResolver): void {
  dialectResolver = resolver;
}

/** The keywords a given vendor's strict-mode validator rejects, from its
 *  module's declared `schemaDialect`. Empty for permissive vendors. */
export function schemaStripKeywordsForVendor(vendorId: string): ReadonlySet<string> {
  return new Set(dialectResolver(vendorId));
}

/** True when the vendor's strict-mode JSON-Schema validator rejects any
 *  draft-07 keywords (i.e. its module declares a non-empty `schemaDialect`). */
export function vendorNeedsSchemaStrip(vendorId: string): boolean {
  return dialectResolver(vendorId).length > 0;
}

/**
 * Deep-strip the given keyword set from a JSON-Schema tree. Pure / non-mutating —
 * returns a new object even when nothing was stripped, so the caller can hand
 * the result back to the vendor body without worrying about shared references.
 *
 * Walks `properties`, `items`, `additionalProperties` (schema form), `oneOf`,
 * `anyOf`, `allOf`. Other keywords are passed through verbatim.
 *
 * `stripKeywords` defaults to {@link CEREBRAS_STRICT_KEYWORDS} so existing
 * callers and tests that don't pass a set keep the historical behaviour.
 */
export function stripUnsupportedSchemaKeywords(
  schema: unknown,
  stripKeywords: ReadonlySet<string> = new Set(CEREBRAS_STRICT_KEYWORDS),
): unknown {
  if (Array.isArray(schema)) {
    return schema.map((s) => stripUnsupportedSchemaKeywords(s, stripKeywords));
  }
  if (schema === null || typeof schema !== 'object') {
    return schema;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (stripKeywords.has(k)) continue;
    if (k === 'properties' && v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const subProps: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
        subProps[pk] = stripUnsupportedSchemaKeywords(pv, stripKeywords);
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
      out[k] = stripUnsupportedSchemaKeywords(v, stripKeywords);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Vendor-aware passthrough for the `extraBody` blob each vendor module hands
 * to its HTTP transport. When the body contains a `response_format` with a
 * `json_schema.schema` payload and the vendor declares a non-empty
 * `schemaDialect`, strips that vendor's incompatible keywords. Everything else
 * is returned verbatim (same object reference) so the call site can do
 *
 *   const safeExtra = sanitizeExtraBodyForVendor('cerebras', extraBody);
 *
 * unconditionally without an extra clone on the happy path.
 */
export function sanitizeExtraBodyForVendor(
  vendorId: string,
  extraBody: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!extraBody) return extraBody;
  const stripKeywords = schemaStripKeywordsForVendor(vendorId);
  if (stripKeywords.size === 0) return extraBody;

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
        schema: stripUnsupportedSchemaKeywords(inner, stripKeywords),
      },
    },
  };
}
