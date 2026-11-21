/**
 * MK-09-W7 — a revoked or expired provider credential is a typed execution outcome,
 * not a raw provider error. 401 and 403 from `repos/githubClient.ts` land here.
 */
export const PROVIDER_AUTH_FAILED = 'provider_auth_failed' as const;

export const PROVIDER_REAUTH_PROMPT =
  'The repository credential was rejected. Reconnect the GitHub App or token in project settings, then retry the run.';

export type ProviderAuthOutcome = {
  outcome: typeof PROVIDER_AUTH_FAILED;
  prompt: string;
};

/** Status → GitHub error code. 401/403 are the auth failure, not a generic provider error. */
export function gitHubErrorCode(status: number): 'provider_auth_failed' | 'not_found' | 'rate_limited' | 'provider_error' {
  if (status === 401 || status === 403) return PROVIDER_AUTH_FAILED;
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  return 'provider_error';
}

export function isProviderAuthFailure(code: string): boolean {
  return code === 'unauthorized' || code === PROVIDER_AUTH_FAILED;
}

export function providerAuthOutcome(status: number, code?: string): ProviderAuthOutcome | null {
  if (status === 401 || status === 403 || (code != null && isProviderAuthFailure(code))) {
    return { outcome: PROVIDER_AUTH_FAILED, prompt: PROVIDER_REAUTH_PROMPT };
  }
  return null;
}

/** Map a free-text provider failure (a PR-open reason) onto the typed outcome. */
export function providerAuthFromText(text: string | null | undefined): ProviderAuthOutcome | null {
  if (!text) return null;
  if (isProviderAuthFailure(text) || /\b401\b|\b403\b|\bunauthorized\b|bad credentials/i.test(text)) {
    return { outcome: PROVIDER_AUTH_FAILED, prompt: PROVIDER_REAUTH_PROMPT };
  }
  return null;
}
