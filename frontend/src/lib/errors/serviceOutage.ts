import type { ApiErrorEvent } from './apiErrorEvent';

/**
 * The API's code for a request refused because the platform's database is
 * temporarily out (api `infrastructure/database/neonAvailability.ts` — a Neon
 * compute-quota refusal). It is the whole platform being down, not this request
 * being wrong, so it reads as "temporarily unavailable" and is never
 * auto-reported: the report would be refused by the same outage.
 */
export const DATABASE_UNAVAILABLE_CODE = 'database_unavailable';

export function isServiceOutage(event: Pick<ApiErrorEvent, 'status' | 'code'>): boolean {
  return event.status === 503 && event.code === DATABASE_UNAVAILABLE_CODE;
}
