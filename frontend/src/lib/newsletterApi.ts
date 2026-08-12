import { apiRequest } from './apiClient';
import { AUTH_API_URL } from './auth';

/**
 * Subscribe an address through Builderforce's canonical public newsletter store.
 *
 * Rides the shared transport like every other call: `auth: 'none'` because the
 * marketing form is reachable logged out, and `baseUrl` because subscribers live on
 * the auth origin rather than the tenant API. A raw `fetch` here skipped the
 * transport's 401 redirect, plan-limit mapping and error reporting for no benefit.
 */
export async function subscribeToNewsletter(email: string, source: string): Promise<void> {
  await apiRequest('/api/auth/newsletter/subscribers', {
    method: 'POST',
    auth: 'none',
    baseUrl: AUTH_API_URL,
    raw: true,
    body: JSON.stringify({ email: email.trim(), action: 'subscribe', source }),
  });
}
