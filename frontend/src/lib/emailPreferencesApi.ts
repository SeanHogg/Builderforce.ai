/**
 * API client for /api/email-preferences — the language transactional email is
 * written in, and consent for non-transactional (lifecycle) email.
 *
 * Uses the WEB token, not the tenant token: these settings belong to the PERSON,
 * not to a workspace (one human in three workspaces has one inbox and one
 * language), and the endpoint is behind `webAuthMiddleware` to match.
 */

import { apiRequest } from './apiClient';
import type { Locale } from '@/i18n/config';

/** The categories a user can opt out of individually. Mirrors the API's
 *  LIFECYCLE_CATEGORIES — the API rejects anything else. */
export const LIFECYCLE_TOGGLES = ['productUpdates', 'onboardingTips', 'digests'] as const;

export type LifecycleToggle = (typeof LIFECYCLE_TOGGLES)[number];

export interface EmailPreferences {
  productUpdates: boolean;
  onboardingTips: boolean;
  digests: boolean;
  /** Global opt-out. Overrides every toggle above; cleared only by `resubscribe`. */
  unsubscribedAll: boolean;
}

export interface EmailPreferencesResponse {
  email: string;
  /** null when never captured — the UI shows "auto-detect", not a false "English". */
  locale: Locale | null;
  supportedLocales: Locale[];
  preferences: EmailPreferences;
}

/**
 * Person-level credential, one transport. This used to be a local copy of the
 * fetch wrapper; the copy set the locale header (correctly — it is the module
 * that most needs it) but dropped `dispatchApiError`, so a failed save here was
 * silent. `apiRequest` supplies both.
 */
const request = <T>(path: string, opts: Parameters<typeof apiRequest>[1] = {}): Promise<T> =>
  apiRequest<T>(path, { ...opts, auth: 'web' });

export const emailPreferencesApi = {
  get: (): Promise<EmailPreferencesResponse> =>
    request<EmailPreferencesResponse>('/api/email-preferences'),

  /** Patch consent and/or the email language. `resubscribe: true` is the ONLY way
   *  to clear a global opt-out — a category toggle deliberately cannot. */
  update: (
    patch: Partial<Pick<EmailPreferences, LifecycleToggle>> & { locale?: Locale; resubscribe?: boolean },
  ): Promise<{ preferences: EmailPreferences }> =>
    request<{ preferences: EmailPreferences }>('/api/email-preferences', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
};
