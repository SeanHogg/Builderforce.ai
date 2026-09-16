/**
 * Marketplace Book — the talent listing's bind to `booking_services`.
 *
 * A person is bookable when they host an active service (`booking_hosts.host_ref`
 * = their user id). The founder reserves through `/api/freelancers/:id/reservations`
 * so the write lands in the advisor's tenant; practice-ops stays authed and is
 * not the public Book path.
 *
 * Overlap is a 409 (`that slot is no longer available`). Pass `expectedErrors:
 * [409]` so the global toast does not fire — the Book panel owns that failure.
 */
import { apiRequestStream, jsonOrThrow } from './transport';

export interface TalentBookingService {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  durationMin: number;
  bufferMin: number;
  priceCents: number;
  currency: string;
  mode: string;
  capacity: number;
}

/** FR-1.2: Book is the primary CTA when a service is bound; otherwise Message. */
export function talentPrimaryAction(bookable: boolean): 'book' | 'message' {
  return bookable ? 'book' : 'message';
}

export async function listTalentBookingServices(talentId: string): Promise<TalentBookingService[]> {
  const res = await apiRequestStream(`/api/freelancers/${encodeURIComponent(talentId)}/booking-services`, { auth: 'web' });
  const body = await jsonOrThrow<{ services: TalentBookingService[] }>(res, 'Failed to load booking services');
  return body.services;
}

export async function reserveTalentSession(input: {
  talentId: string;
  serviceId: number;
  startsAt: string;
  timezone?: string;
}): Promise<{ id: number; startsAt: string; endsAt: string; status: string }> {
  const res = await apiRequestStream(
    `/api/freelancers/${encodeURIComponent(input.talentId)}/reservations`,
    {
      method: 'POST',
      auth: 'tenant',
      body: JSON.stringify({
        serviceId: input.serviceId,
        startsAt: input.startsAt,
        timezone: input.timezone,
      }),
      expectedErrors: [409],
    },
  );
  return jsonOrThrow(res, 'Failed to book');
}
