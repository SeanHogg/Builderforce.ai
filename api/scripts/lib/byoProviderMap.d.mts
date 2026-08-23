/**
 * Types for the derived BYO provider inference.
 *
 * The script itself is deliberately plain `.mjs` — it runs under bare node with no
 * build step — but it has a second consumer that DOES typecheck
 * (`src/application/llm/byoProviderMap.test.ts`, the drift guard). An untyped import
 * there would make every assertion `any`, which is how a pinned contract quietly
 * stops checking anything. Hand-written rather than generated: the module is small
 * and its shape is the contract.
 */

export interface ByoModelInference {
  /** Gateway vendor id → BYO provider. The lexical twin of `providerForVendor`. */
  providerByVendor: Map<string, string>;
  /** Explicit routing prefixes owning a tenant-ownable vendor, longest first. */
  standalonePrefixes: Array<[prefix: string, provider: string]>;
  /** Bare model-id family stems (`claude-`) → provider, longest first. */
  modelFamilies: Array<[family: string, provider: string]>;
  /** The BYO provider a recorded model id belongs to, or `null` if unattributable. */
  providerForModel(model: string | null | undefined): string | null;
}

export function loadByoModelInference(): ByoModelInference;
