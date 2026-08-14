/**
 * Timecards — the time-and-billing half of an engagement.
 *
 * Split out of `freelancerApi.ts` when that module crossed the 800-line architecture
 * ratchet. The split is by BOUNDED CONTEXT rather than by line count: a timecard is its
 * own concept with its own lifecycle (draft → submitted → approved → rejected → paid),
 * its own entries, and its own two audiences — the person logging the hours and the
 * client approving them. Nothing outside that lifecycle belongs here, and nothing in it
 * belongs in the profile module.
 *
 * Every call goes through the same shared transport and error envelope the rest of the
 * freelance surface uses — see the note on {@link jsonOrThrow} in `freelancerApi.ts`.
 */

import { apiRequestStream } from './apiClient';

async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? fallback);
  }
  return res.json() as Promise<T>;
}

export interface Timecard {
  id: string;
  engagementId: string;
  tenantId: number;
  tenantName: string | null;
  freelancerName: string | null;
  periodStart: string;
  periodEnd: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid';
  totalMinutes: number;
  billableMinutes: number;
  rateCents: number | null;
  currency: string;
  amountCents: number;
  submittedAt: string | null;
  approvedAt: string | null;
}

export async function resolveTimecard(input: { engagementId: string; periodStart: string; periodEnd: string }): Promise<{ id: string; totalMinutes: number; billableMinutes: number }> {
  const res = await apiRequestStream(`/api/timecards/resolve`, { method: 'POST', auth: 'web', body: JSON.stringify(input) });
  return jsonOrThrow(res, 'Failed to resolve timecard');
}

export async function listMyTimecards(): Promise<Timecard[]> {
  const res = await apiRequestStream(`/api/timecards/mine`, { auth: 'web' });
  return jsonOrThrow<Timecard[]>(res, 'Failed to load timecards');
}

export async function listEmployerTimecards(): Promise<Timecard[]> {
  const res = await apiRequestStream(`/api/timecards`, { auth: 'tenant' });
  return jsonOrThrow<Timecard[]>(res, 'Failed to load timecards');
}

export async function submitTimecard(id: string): Promise<void> {
  const res = await apiRequestStream(`/api/timecards/${id}/submit`, { method: 'POST', auth: 'web' });
  await jsonOrThrow(res, 'Failed to submit');
}

export async function approveTimecard(id: string): Promise<void> {
  const res = await apiRequestStream(`/api/timecards/${id}/approve`, { method: 'POST', auth: 'tenant' });
  await jsonOrThrow(res, 'Failed to approve');
}

export async function rejectTimecard(id: string, reason?: string): Promise<void> {
  const res = await apiRequestStream(`/api/timecards/${id}/reject`, { method: 'POST', auth: 'tenant', body: JSON.stringify({ reason }) });
  await jsonOrThrow(res, 'Failed to reject');
}

export interface TimecardEntry {
  id: string;
  workDate: string;
  minutes: number;
  source: 'auto' | 'manual' | 'meeting';
  billable: boolean;
  description: string | null;
}

// Worker: view + edit the line items on a draft timecard.
export async function listTimecardEntries(id: string): Promise<TimecardEntry[]> {
  const res = await apiRequestStream(`/api/timecards/${id}/entries`, { auth: 'web' });
  return jsonOrThrow<TimecardEntry[]>(res, 'Failed to load entries');
}

export async function addTimecardEntry(id: string, input: { workDate?: string; minutes: number; description?: string; billable?: boolean }): Promise<void> {
  const res = await apiRequestStream(`/api/timecards/${id}/entries`, { method: 'POST', auth: 'web', body: JSON.stringify(input) });
  await jsonOrThrow(res, 'Failed to add entry');
}

export async function updateTimecardEntry(id: string, entryId: string, patch: { minutes?: number; billable?: boolean; description?: string }): Promise<void> {
  const res = await apiRequestStream(`/api/timecards/${id}/entries/${entryId}`, { method: 'PATCH', auth: 'web', body: JSON.stringify(patch) });
  await jsonOrThrow(res, 'Failed to update entry');
}

export async function deleteTimecardEntry(id: string, entryId: string): Promise<void> {
  const res = await apiRequestStream(`/api/timecards/${id}/entries/${entryId}`, { method: 'DELETE', auth: 'web' });
  await jsonOrThrow(res, 'Failed to delete entry');
}

// Employer: the approval view (card + its entries), tenant-scoped.
export async function getTimecardReview(id: string): Promise<{ card: Timecard; entries: TimecardEntry[] }> {
  const res = await apiRequestStream(`/api/timecards/${id}/review`, { auth: 'tenant' });
  return jsonOrThrow(res, 'Failed to load timecard');
}
