/**
 * The guest chat ROUND-TRIP meter.
 *
 * The guest allowance the UI counts down (`GuestChatService`) is per user SUBMIT: every
 * tool continuation of one canvas turn reuses the submit's `turnId` and costs nothing
 * more. With no step cap on the canvas loop, that left the actual spend — model
 * round-trips — unmetered for anonymous traffic. This charges EVERY model call a guest
 * makes, continuation or not, against a daily per-visitor and per-IP ceiling
 * (`GUEST_CHAT_LIMITS.roundTripsDailyLimit` / `ipRoundTripsDailyLimit`), on the shared
 * anonymous-allowance primitive (`consumeGuestAllowance`) under its own scope so it never
 * rations the submit counter or any other guest capability.
 */

import type { Env } from '../../env';
import { GUEST_CHAT_LIMITS } from '../../domain/tenant/PlanLimits';
import { consumeGuestAllowance, type GuestAllowance } from './guestDailyCounter';

/** The counter scope — independent of the submit counter (`guestchat:ip`). */
export const GUEST_ROUND_TRIP_SCOPE = 'guestchat:rt';

/** Charge one model round-trip, or refuse it once today's ceiling is spent. */
export function consumeGuestRoundTrip(env: Env, visitorId: string, ip: string | null): Promise<GuestAllowance> {
  return consumeGuestAllowance(env, GUEST_ROUND_TRIP_SCOPE, visitorId, ip, {
    visitorDailyLimit: GUEST_CHAT_LIMITS.roundTripsDailyLimit,
    ipDailyLimit: GUEST_CHAT_LIMITS.ipRoundTripsDailyLimit,
  });
}
