/**
 * INVITES and SAVED TALENT — the client reaching out, in both of its shapes.
 *
 * An invite is an ASK a freelancer answers; a saved-talent entry is a private
 * bookmark nobody else sees. They live together because they are the same errand
 * at two levels of commitment, and a shortlist is where an invite comes from.
 *
 * Transport, and why it is not `fetch`: see `./transport`.
 */
import { apiRequestStream, jsonOrThrow } from './transport';

// ---- Job invites (0985) --------------------------------------------------

/** An invitation to ONE named freelancer to bid on ONE posting. A state machine with an
 *  expiry and an outcome — not a notification. */
export interface JobInvite {
  id: string;
  jobId: string;
  jobTitle: string | null;
  tenantId: number;
  tenantName: string | null;
  freelancerUserId: string;
  freelancerName: string | null;
  message: string | null;
  status: 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired';
  expiresAt: string | null;
  respondedAt: string | null;
  /** The proposal an acceptance opened — the reason this lands in the bid flow. */
  proposalId: string | null;
  createdAt: string | null;
}

/** The invitee's side of the marketplace. */
export async function listMyInvites(liveOnly = false): Promise<JobInvite[]> {
  const res = await apiRequestStream(`/api/jobs/invites/mine${liveOnly ? '?live=1' : ''}`, { auth: 'web' });
  return jsonOrThrow<JobInvite[]>(res, 'Failed to load invitations');
}

export async function markInviteViewed(inviteId: string): Promise<void> {
  const res = await apiRequestStream(`/api/jobs/invites/${inviteId}/viewed`, { method: 'POST', auth: 'web' });
  await jsonOrThrow(res, 'Failed');
}

/** Accept or decline. Accepting returns the `proposalId` it opened, so the caller can go
 *  straight to the bid form rather than back to a list. */
export async function respondToInvite(inviteId: string, accept: boolean): Promise<{ invite: JobInvite; proposalId: string | null }> {
  const res = await apiRequestStream(`/api/jobs/invites/${inviteId}/respond`, { method: 'POST', auth: 'web', body: JSON.stringify({ accept }) });
  return jsonOrThrow(res, 'Failed to respond to the invitation');
}

/** The employer's side: who this posting has invited, and what they said. */
export async function listJobInvites(jobId: string): Promise<JobInvite[]> {
  const res = await apiRequestStream(`/api/jobs/${jobId}/invites`, { auth: 'tenant' });
  return jsonOrThrow<JobInvite[]>(res, 'Failed to load invitations');
}

export async function inviteToJob(jobId: string, input: { freelancerUserId: string; message?: string; expiresInDays?: number }): Promise<JobInvite> {
  const res = await apiRequestStream(`/api/jobs/${jobId}/invites`, { method: 'POST', auth: 'tenant', body: JSON.stringify(input) });
  return jsonOrThrow<JobInvite>(res, 'Failed to send the invitation');
}

export async function withdrawJobInvite(jobId: string, inviteId: string): Promise<void> {
  const res = await apiRequestStream(`/api/jobs/${jobId}/invites/${inviteId}`, { method: 'DELETE', auth: 'tenant' });
  await jsonOrThrow(res, 'Failed to withdraw the invitation');
}

// ---- Saved talent — the client's shortlist (0985) -------------------------

export interface SavedTalentEntry {
  id: string;
  freelancerUserId: string;
  listName: string;
  note: string | null;
  createdAt: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  headline: string | null;
  discipline: string | null;
  skills: string[];
  hourlyRateCents: number | null;
  currency: string;
  availability: string | null;
  rating: number | null;
  ratingCount: number;
}

export async function listSavedTalent(list?: string): Promise<{ items: SavedTalentEntry[]; lists: Array<{ name: string; count: number }> }> {
  const res = await apiRequestStream(`/api/marketplace/saved-talent${list ? `?list=${encodeURIComponent(list)}` : ''}`, { auth: 'tenant' });
  return jsonOrThrow(res, 'Failed to load your shortlist');
}

export async function saveTalent(input: { freelancerUserId: string; list?: string; note?: string }): Promise<{ id: string }> {
  const res = await apiRequestStream(`/api/marketplace/saved-talent`, { method: 'POST', auth: 'tenant', body: JSON.stringify(input) });
  return jsonOrThrow(res, 'Failed to shortlist');
}

export async function unsaveTalent(freelancerUserId: string, list?: string): Promise<void> {
  const res = await apiRequestStream(`/api/marketplace/saved-talent/${freelancerUserId}${list ? `?list=${encodeURIComponent(list)}` : ''}`, { method: 'DELETE', auth: 'tenant' });
  await jsonOrThrow(res, 'Failed to remove from your shortlist');
}

