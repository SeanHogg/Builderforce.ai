import type { ResponseFormat } from '../domain/types';

/**
 * deriveResponseFormat — pick the strongest `response_format` a request can SAFELY
 * use given how complex its JSON-Schema is and (optionally) which vendor will
 * serve it.
 *
 * The problem this solves: a strict `json_schema` gives the best conformance, but
 * some vendors' constrained-decoding engines reject a schema that's too complex
 * (Gemini's "too many states for serving"). The gateway now surfaces that as a
 * terminal `schema_too_complex` error — but the cleaner fix is to NOT send a
 * strict schema a vendor can't honour in the first place. This utility is the
 * pre-flight guard: it emits `{ type: 'json_schema', strict }` when the schema is
 * within the (vendor-specific or conservative-default) complexity ceiling, and
 * falls back to `{ type: 'json_object' }` (loose JSON mode — universally
 * supported) when it isn't.
 *
 * The SDK is zero-dependency, so this takes a plain JSON-Schema object — convert
 * a Zod schema first with `zod-to-json-schema` (`deriveResponseFormat(zodToJsonSchema(MySchema), …)`).
 */

export interface DeriveResponseFormatOptions {
  /** Schema name sent as `json_schema.name` (default `'response'`). */
  name?: string;
  /** Set `json_schema.strict` when a strict schema is emitted (default `true`). */
  strict?: boolean;
  /**
   * The vendor that will serve the request, when known (the consumer pinned a
   * `model`). Selects that vendor's specific complexity ceiling. Omit when
   * routing is gateway-owned — the conservative default ceiling (the lowest
   * common denominator across vendors) is used so the schema is accepted
   * whichever vendor the gateway picks.
   */
  vendor?: string;
  /**
   * Override the complexity ceiling (max schema "nodes"; see
   * {@link estimateSchemaComplexity}). Above this, loose `json_object` is emitted.
   * Wins over the vendor/default ceiling.
   */
  maxComplexity?: number;
}

export interface SchemaComplexity {
  /** Total schema nodes — every property, array `items`, and enum value counts one. */
  nodes: number;
  /** Deepest nesting level reached. */
  maxDepth: number;
  /** Total enum values across the whole schema (the main driver of constrained-
   *  decoding state blow-up). */
  totalEnumValues: number;
  /** Single rolled-up score compared against the ceiling: `nodes + totalEnumValues`. */
  score: number;
}

/**
 * Conservative cross-vendor ceiling, used when no `vendor` is supplied (gateway-
 * owned routing). Tuned below the lowest-ceiling vendor (Gemini's constrained-
 * decoding "too many states" limit) so a schema that passes here is accepted by
 * ANY vendor the gateway might route to.
 */
export const DEFAULT_SCHEMA_COMPLEXITY_CEILING = 80;

/**
 * Per-vendor strict-`json_schema` complexity ceilings (heuristic). A vendor absent
 * from this map is assumed capable at the {@link DEFAULT_SCHEMA_COMPLEXITY_CEILING}.
 * `0` marks a vendor that does NOT support strict json_schema at all (always loose).
 * These are SDK-side heuristics — the authoritative limits ride the gateway model
 * catalog; tune via `maxComplexity` when you have vendor-specific knowledge.
 */
const VENDOR_SCHEMA_CEILINGS: Readonly<Record<string, number>> = {
  // Low constrained-decoding ceiling — the vendor that motivated this guard.
  googleai: 60,
  google: 60,
  gemini: 60,
  // High-ceiling, robust strict-schema vendors.
  openai: 600,
  anthropic: 600,
  cerebras: 300,
  nvidia: 300,
  openrouter: 200,
};

const MAX_SCHEMA_WALK_DEPTH = 64; // cycle / runaway-recursion guard

/**
 * Estimate a JSON-Schema's complexity. The dominant cost for constrained decoding
 * is the number of distinct states the engine must track, which grows with the
 * node count and (especially) the total number of enum values. Pure + cheap.
 */
export function estimateSchemaComplexity(schema: unknown): SchemaComplexity {
  let nodes = 0;
  let totalEnumValues = 0;
  let maxDepth = 0;

  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_SCHEMA_WALK_DEPTH || node === null || typeof node !== 'object') return;
    if (depth > maxDepth) maxDepth = depth;
    const s = node as Record<string, unknown>;

    const enumVals = s['enum'];
    if (Array.isArray(enumVals)) totalEnumValues += enumVals.length;

    const props = s['properties'];
    if (props && typeof props === 'object') {
      for (const key of Object.keys(props)) {
        nodes += 1;
        walk((props as Record<string, unknown>)[key], depth + 1);
      }
    }

    // Array item schemas (single schema or tuple form).
    const items = s['items'];
    if (Array.isArray(items)) items.forEach((it) => { nodes += 1; walk(it, depth + 1); });
    else if (items && typeof items === 'object') { nodes += 1; walk(items, depth + 1); }

    // Composition keywords contribute their branches.
    for (const comb of ['anyOf', 'oneOf', 'allOf'] as const) {
      const arr = s[comb];
      if (Array.isArray(arr)) arr.forEach((sub) => { nodes += 1; walk(sub, depth + 1); });
    }

    // `$defs` / `definitions` referenced shapes.
    for (const defsKey of ['$defs', 'definitions'] as const) {
      const defs = s[defsKey];
      if (defs && typeof defs === 'object') {
        for (const key of Object.keys(defs)) walk((defs as Record<string, unknown>)[key], depth + 1);
      }
    }
  };

  walk(schema, 0);
  return { nodes, maxDepth, totalEnumValues, score: nodes + totalEnumValues };
}

/** The complexity ceiling that applies for the given options. */
function ceilingFor(opts?: DeriveResponseFormatOptions): number {
  if (opts?.maxComplexity != null && opts.maxComplexity >= 0) return opts.maxComplexity;
  if (opts?.vendor) {
    const v = opts.vendor.toLowerCase();
    if (v in VENDOR_SCHEMA_CEILINGS) return VENDOR_SCHEMA_CEILINGS[v]!;
  }
  return DEFAULT_SCHEMA_COMPLEXITY_CEILING;
}

/**
 * True when a strict `json_schema` is safe for the given schema + vendor (i.e.
 * within the complexity ceiling, and the vendor isn't strict-schema-incapable).
 * Exposed so callers can branch (e.g. log a downgrade) without re-deriving.
 */
export function canUseStrictSchema(schema: unknown, opts?: DeriveResponseFormatOptions): boolean {
  const ceiling = ceilingFor(opts);
  if (ceiling === 0) return false; // vendor declared incapable
  return estimateSchemaComplexity(schema).score <= ceiling;
}

/**
 * Derive the strongest safe `response_format`:
 *   • within the ceiling → `{ type: 'json_schema', json_schema: { name, schema, strict } }`
 *   • over the ceiling   → `{ type: 'json_object' }` (loose JSON; instruct the
 *     model to follow the shape in your prompt)
 *
 * Pure — returns a value the consumer drops straight into
 * `chat.completions.create({ response_format })`.
 */
export function deriveResponseFormat(
  schema: Record<string, unknown>,
  opts?: DeriveResponseFormatOptions,
): ResponseFormat {
  if (!canUseStrictSchema(schema, opts)) {
    return { type: 'json_object' };
  }
  return {
    type: 'json_schema',
    json_schema: {
      name: opts?.name ?? 'response',
      schema,
      strict: opts?.strict ?? true,
    },
  };
}
