/**
 * INVOICES and the NOTIFICATIONS feed.
 *
 * An invoice is the money side of an approved timecard — it is generated FROM an
 * engagement but settled independently of it, and the employer and the worker each
 * read their own list. The notification feed sits here because every notification
 * this marketplace sends is about one of these two ledgers moving.
 *
 * Transport, and why it is not `fetch`: see `./transport`.
 */
import { apiRequestStream, jsonOrThrow } from './transport';

export interface Notification {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  ref: string | null;
  read: boolean;
  createdAt: string | null;
}

export interface Invoice {
  id: string;
  timecardId: string;
  engagementId: string;
  tenantId: number;
  tenantName?: string | null;
  freelancerName?: string | null;
  amountCents: number;
  currency: string;
  status: 'pending' | 'paid' | 'void';
  externalRef: string | null;
  issuedAt: string | null;
  paidAt: string | null;
}

// ---- Invoices + payments -------------------------------------------------
export async function listEmployerInvoices(): Promise<Invoice[]> {
  const res = await apiRequestStream(`/api/timecards/invoices`, { auth: 'tenant' });
  return jsonOrThrow<Invoice[]>(res, 'Failed to load invoices');
}

export async function listMyInvoices(): Promise<Invoice[]> {
  const res = await apiRequestStream(`/api/timecards/invoices/mine`, { auth: 'web' });
  return jsonOrThrow<Invoice[]>(res, 'Failed to load invoices');
}

/** Settle an invoice: uses the payout provider when configured, else falls back to
 *  a manual record. Returns whether the provider path ran. */
export async function payInvoice(invId: string): Promise<{ paid: boolean; manual: boolean }> {
  const res = await apiRequestStream(`/api/timecards/invoices/${invId}/pay`, { method: 'POST', auth: 'tenant' });
  if (res.status === 409) { // no payout provider — fall back to manual record
    const m = await apiRequestStream(`/api/timecards/invoices/${invId}/mark-paid`, { method: 'POST', auth: 'tenant' });
    await jsonOrThrow(m, 'Failed to mark paid');
    return { paid: true, manual: true };
  }
  await jsonOrThrow(res, 'Failed to pay');
  return { paid: true, manual: false };
}

// ---- Notifications feed --------------------------------------------------
export async function listNotifications(): Promise<{ unread: number; items: Notification[] }> {
  const res = await apiRequestStream(`/api/notifications`, { auth: 'web' });
  return jsonOrThrow(res, 'Failed to load notifications');
}

export async function markNotificationsRead(ids?: number[]): Promise<void> {
  const res = await apiRequestStream(`/api/notifications/read`, { method: 'POST', auth: 'web', body: JSON.stringify({ ids }) });
  await jsonOrThrow(res, 'Failed');
}

