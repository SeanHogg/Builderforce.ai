/**
 * The WRITER of a self-hosted runtime's stored credential — the inverse of
 * `vendors/selfHostedSentinel.ts`'s `splitSelfHostedSentinel`.
 *
 * Every BYO provider whose shared catalog entry says `credential: 'local_runtime'`
 * (`@builderforce/model-catalog`: self-hosted Ollama, FreeToken, and any runtime added
 * there later) stores `<apiKey>::<baseUrl>::<model>` instead of a bare key. This used to
 * be composed inline in the route for `ollama-local` only, so FreeToken fell through to
 * the bare-key branch and saved a value its vendor could not split back apart. Keying on
 * the shared data — never on a provider name — is what keeps the next runtime from
 * repeating that.
 *
 * Pure: validation + composition, no storage. The route persists what this returns.
 */

import { llmProviderInfo, type LlmProvider } from '@builderforce/model-catalog';
import { SELF_HOSTED_SEPARATOR } from './vendors/selfHostedSentinel';

/** Whether a provider is configured by base URL + model rather than a pasted key. */
export function isLocalRuntimeProvider(provider: LlmProvider): boolean {
  return llmProviderInfo(provider).credential === 'local_runtime';
}

export interface SelfHostedCredentialInput {
  baseUrl?: string | null;
  model?: string | null;
  apiKey?: string | null;
}

export type SelfHostedCredentialResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Validate and compose a self-hosted credential. `baseUrl` (http/https) and `model` are
 * REQUIRED; `apiKey` is optional (a self-hosted runtime commonly has no auth). No field
 * may contain the separator — a stray one would desync the split.
 */
export function composeSelfHostedCredential(input: SelfHostedCredentialInput): SelfHostedCredentialResult {
  const baseUrl = input.baseUrl?.trim();
  const model = input.model?.trim();
  const apiKey = input.apiKey?.trim() ?? '';
  if (!baseUrl) return { ok: false, error: 'baseUrl is required' };
  if (!model) return { ok: false, error: 'model is required' };
  let parsedUrl: URL;
  try { parsedUrl = new URL(baseUrl); } catch { return { ok: false, error: 'baseUrl must be a valid URL' }; }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { ok: false, error: 'baseUrl must be http or https' };
  }
  if ([baseUrl, model, apiKey].some((field) => field.includes(SELF_HOSTED_SEPARATOR))) {
    return { ok: false, error: `baseUrl, model, and apiKey may not contain "${SELF_HOSTED_SEPARATOR}"` };
  }
  return { ok: true, value: [apiKey, baseUrl, model].join(SELF_HOSTED_SEPARATOR) };
}
