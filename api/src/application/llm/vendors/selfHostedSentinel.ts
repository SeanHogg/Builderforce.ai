/**
 * The credential shape shared by every SELF-HOSTED runtime vendor — a tenant's own
 * Ollama (`ollamaLocal.ts`) or FreeToken (`freetoken.ts`) instance.
 *
 * The registry's `apiKeyFrom(env): string | null` contract is a SINGLE string, but a
 * self-hosted connection is irreducibly three values: where it lives, which model it
 * serves, and an optional token if it sits behind a reverse proxy. So the provider row
 * composes `<apiKey>::<baseUrl>::<model>` and the vendor splits it back apart — the same
 * two-value trick `azureOpenai.ts` and `amazonBedrock.ts` use, except those two carry
 * genuinely different field sets (an endpoint pair, an AWS triple) and so keep their own
 * parsers. THIS shape is identical across the self-hosted runtimes, which is why it lives
 * here once rather than being copied per vendor.
 *
 * `apiKey` is usually empty — a self-hosted runtime has no auth by default — and is kept
 * only for an instance published behind a token-checking proxy. `baseUrl` and `model` are
 * required: without them there is nothing to call and nothing to call it with.
 */

import { VendorFatalError, type VendorId } from './types';

/** The three fields a self-hosted connection carries. */
export interface SelfHostedConnection {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const SEPARATOR = '::';

/**
 * Split `<apiKey>::<baseUrl>::<model>` apart, or throw {@link VendorFatalError} when the
 * stored value is not that shape.
 *
 * FATAL rather than retryable on purpose: a malformed sentinel is a broken provider row,
 * not a transient upstream problem, so retrying it across the cascade would burn the
 * whole chain to reach the same conclusion. Splitting on the FIRST two separators means a
 * model id containing `::` (nothing forbids it) still round-trips.
 */
export function splitSelfHostedSentinel(vendorId: VendorId, raw: string): SelfHostedConnection {
  const malformed = (): never => {
    throw new VendorFatalError(
      vendorId,
      500,
      `malformed ${vendorId} sentinel (expected "<apiKey>::<baseUrl>::<model>")`,
    );
  };
  const i = raw.indexOf(SEPARATOR);
  if (i < 0) return malformed();
  const rest = raw.slice(i + SEPARATOR.length);
  const j = rest.indexOf(SEPARATOR);
  if (j < 0) return malformed();
  return {
    apiKey: raw.slice(0, i),
    baseUrl: rest.slice(0, j),
    model: rest.slice(j + SEPARATOR.length),
  };
}

/**
 * Reduce a stored base URL to the runtime's ROOT, so each vendor can append its own
 * path without ever producing `/v1/v1/...` or a doubled slash.
 *
 * Strips a trailing `/v1` because that is the form most provider docs show, and a tenant
 * who pastes it must land in the same place as one who pastes the bare origin. For
 * `ollama-local` this also has to agree byte-for-byte with the on-prem host's own
 * `resolveOllamaApiBase`, since the host's egress fence compares the resulting path
 * against its allowlisted one.
 */
export function normalizeSelfHostedBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}
