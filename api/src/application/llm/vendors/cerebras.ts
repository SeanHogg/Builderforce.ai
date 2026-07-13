/**
 * Cerebras vendor module — sub-200ms TTFT inference for latency-critical use cases
 * (classification, simple routing, fast first-token chat).
 *
 * Quotas (2026-05): llama3.1-8b — 30 req/min, 60K tok/min, 14.4K req/day, 1M tok/day.
 *                  qwen-3-235b — 1 req/min, 30K tok/min, 14.4K req/day, 1M tok/day.
 *
 * Cerebras is OpenAI-compatible, so it's built from the shared
 * {@link createOpenAICompatibleVendor} factory — with two quirks threaded through:
 *   - `max_completion_tokens` (Cerebras's preferred output-token field), and
 *   - a draft-07 JSON-Schema sanitize on the `extraBody` passthrough (its strict
 *     validator rejects `maxLength`/`format`/`pattern`/… that Zod's `toJSONSchema()`
 *     emits — see jsonSchemaSanitize.ts).
 * Unlike the commercial OpenAI-compatible vendors, Cerebras is FREE-tier and
 * `autoRoute: true` — it stays in the auto-selected FREE pool exactly as before.
 */

import { createOpenAICompatibleVendor } from './openaiCompatible';
import type { VendorModelEntry } from './types';
import { CEREBRAS_STRICT_KEYWORDS, sanitizeExtraBodyForVendor } from '../jsonSchemaSanitize';

const CATALOG: ReadonlyArray<VendorModelEntry> = [
  { id: 'llama3.1-8b',                      tier: 'FREE', label: 'Llama 3.1 8B (Cerebras · Fast)',   brand: 'Cerebras' },
  { id: 'qwen-3-235b-a22b-instruct-2507',   tier: 'FREE', label: 'Qwen 3 235B (Cerebras · Preview)', brand: 'Cerebras' },
];

export const cerebrasModule = createOpenAICompatibleVendor({
  id: 'cerebras',
  baseUrl: 'https://api.cerebras.ai/v1/chat/completions',
  apiKeyEnv: 'CEREBRAS_API_KEY',
  catalog: CATALOG,
  defaultTier: 'FREE',
  autoRoute: true,
  maxTokensField: 'max_completion_tokens',
  // Declares the strict-mode strip set so the sanitizer is metadata-driven
  // (no hardcoded vendor-id list). `transformExtra` reads it back via the
  // registry-wired resolver.
  schemaDialect: { stripKeywords: CEREBRAS_STRICT_KEYWORDS },
  transformExtra: (extra) => sanitizeExtraBodyForVendor('cerebras', extra),
});
