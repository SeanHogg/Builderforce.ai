/**
 * Workers AI access — the credential pair and the native REST endpoint, shared by every
 * caller that reaches the account's AI over HTTP (the Cloudflare embeddings vendor, the
 * reranker, the translation adapter). One place, so the URL shape and the "either half
 * unset means unconfigured" rule cannot drift between them.
 */

/** The Workers AI credential pair, or null when either half is unset. */
export function workersAiCredentials(env: { CLOUDFLARE_AI_API_TOKEN?: string | null; CLOUDFLARE_ACCOUNT_ID?: string | null }): { token: string; accountId: string } | null {
  const token = env.CLOUDFLARE_AI_API_TOKEN ?? null;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? null;
  return token && accountId ? { token, accountId } : null;
}

/** The native `/ai/run/<model>` endpoint for one account. */
export function workersAiRunEndpoint(accountId: string, model: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
}
