/**
 * Cerebras vendor module — sub-200ms TTFT inference for latency-critical use cases
 * (classification, simple routing, fast first-token chat).
 *
 * Catalog = Cerebras's public `GET /public/v1/models` (no key needed; it is a source in
 * `scripts/refresh-model-snapshot.mjs`, so the drift guard judges these ids). Cerebras
 * retired `llama3.1-8b` and `qwen-3-235b-a22b-instruct-2507` in 2026-10; both 404'd
 * 167 times in one week before the source existed. Each is superseded below, so a
 * stored or caller-supplied pin keeps dispatching on Cerebras.
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
import { CEREBRAS_STRICT_KEYWORDS } from '../jsonSchemaSanitize';

const CATALOG: ReadonlyArray<VendorModelEntry> = [
  { id: 'gpt-oss-120b', tier: 'FREE', label: 'GPT-OSS 120B (Cerebras · Fast)', brand: 'Cerebras' },
  { id: 'qwen-3.8-27b', tier: 'FREE', label: 'Qwen 3.8 27B (Cerebras)',        brand: 'Cerebras', capabilities: ['vision'] },
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
  // (no hardcoded vendor-id list). The factory applies a declared dialect itself.
  schemaDialect: { stripKeywords: CEREBRAS_STRICT_KEYWORDS },
});
