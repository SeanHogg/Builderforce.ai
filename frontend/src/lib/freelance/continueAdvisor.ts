/**
 * Continue a completed advisor session without searching the marketplace.
 *
 * The advisor is `booking_hosts.host_ref` (the talent user id) already stored
 * on the completed reservation. The second book goes through
 * {@link reserveTalentSession} — the same founder write A0 uses — with that
 * host and service, not through a listing search.
 */
import { reserveTalentSession } from './booking';

export interface CompletedAdvisorSession {
  reservationId: number;
  /** `booking_reservations.host_ref` — the advisor's user id. */
  advisorUserId: string;
  serviceId: number;
  timezone?: string | null;
}

/** Only a finished session is a relationship to continue. */
export const CONTINUABLE_STATUS = 'completed';

export function isContinuable(status: string): boolean {
  return status === CONTINUABLE_STATUS;
}

/** The second session is the same advisor and the same service. */
export function continuationTarget(session: CompletedAdvisorSession): {
  talentId: string;
  serviceId: number;
} {
  const talentId = session.advisorUserId.trim();
  if (!talentId) throw new Error('a continued session needs the advisor');
  if (!Number.isInteger(session.serviceId) || session.serviceId <= 0) {
    throw new Error('a continued session needs the service');
  }
  return { talentId, serviceId: session.serviceId };
}

export async function continueAdvisorSession(
  session: CompletedAdvisorSession,
  startsAt: string,
  timezone?: string,
): Promise<{ id: number; startsAt: string; endsAt: string; status: string }> {
  const target = continuationTarget(session);
  return reserveTalentSession({
    talentId: target.talentId,
    serviceId: target.serviceId,
    startsAt,
    timezone: timezone ?? session.timezone ?? undefined,
  });
}
