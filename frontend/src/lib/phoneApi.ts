/**
 * The Business Phone console — the typed client.
 *
 * Its own module, for the same reason `pointsApi.ts` is: one domain, one client,
 * droppable into a second surface without dragging the rest of the platform's API
 * surface behind it. Nothing here decides anything — every entitlement, price and
 * refusal is the server's answer, projected as-is.
 *
 * ── EVERY WRITE CAN BE REFUSED, AND THE REASON MATTERS ───────────────────────
 * `addon_inactive` (403), `insufficient_credit` (402), `no_sending_number` and
 * `number_taken` (409) each need a DIFFERENT thing from the operator: buy the
 * add-on, top up, provision a number, pick another number. Collapsing them into
 * one "failed" string is how somebody ends up topping up a balance to fix a
 * subscription that lapsed, so the reason is preserved and the UI branches on it.
 */
import { apiRequestStream } from './apiClient';
import { jsonOrThrow } from './apiEnvelope';

export type PhoneRefusalReason =
  | 'addon_inactive'
  | 'insufficient_credit'
  | 'no_sending_number'
  | 'number_taken'
  | 'vendor_refused'
  | 'delivery_not_recorded';

/** A refusal the surface must EXPLAIN rather than just report. */
export class PhoneRefusal extends Error {
  constructor(readonly reason: PhoneRefusalReason | string, message: string) {
    super(message);
    this.name = 'PhoneRefusal';
  }
}

export interface ProvisionedNumber {
  id: number;
  e164: string;
  provider: string;
  providerRef: string | null;
  country: string | null;
  status: string;
  monthlyCents: number;
}

export interface AvailableNumber {
  e164: string;
  friendlyName: string;
  locality: string | null;
  region: string | null;
  capabilities: { voice: boolean; sms: boolean; mms: boolean };
}

export interface CommsRate {
  unit: 'sms_segment' | 'mms_message' | 'voice_minute' | 'number_month';
  cents: number;
  label: string;
}

export interface PhonePlanSummary {
  active: boolean;
  status: string;
  includedNumbers: number;
  allowanceCents: number;
}

export interface PhoneOverview {
  balanceCents: number;
  numbers: ProvisionedNumber[];
  plan: PhonePlanSummary;
  rates: CommsRate[];
}

export interface CommsLedgerRow {
  id: number;
  cents: number;
  kind: string;
  memo: string | null;
  occurredAt: string;
}

export interface SmsThreadRow {
  id: number;
  direction: 'inbound' | 'outbound';
  counterparty: string;
  body: string;
  status: string;
  occurredAt: string;
}

export interface CallLogRow {
  id: number;
  direction: string;
  counterparty: string;
  status: string;
  durationSeconds: number;
  costCents: number;
  occurredAt: string;
}

export interface TopUpPack {
  id: string;
  cents: number;
}

/**
 * Read a refusal out of a non-OK response.
 *
 * The API answers a refusal as `{ error: '<reason>', ...detail }`, so this is the
 * one place that shape is decoded — every write below funnels through it and no
 * component has to know the envelope.
 */
async function orRefuse<T>(res: Response, fallback: string): Promise<T> {
  if (res.ok) return res.json() as Promise<T>;
  const body = await res.json().catch(() => null) as { error?: string; detail?: string } | null;
  if (body?.error) throw new PhoneRefusal(body.error, body.detail ?? body.error);
  throw new Error(fallback);
}

export async function fetchPhoneOverview(): Promise<PhoneOverview> {
  const res = await apiRequestStream('/api/phone', { auth: 'tenant' });
  return jsonOrThrow<PhoneOverview>(res, 'Failed to load your phone service');
}

export async function fetchPhoneStatement(limit = 50): Promise<CommsLedgerRow[]> {
  const res = await apiRequestStream(`/api/phone/statement?limit=${limit}`, { auth: 'tenant' });
  return (await jsonOrThrow<{ rows: CommsLedgerRow[] }>(res, 'Failed to load the statement')).rows;
}

export async function fetchPhoneMessages(limit = 50): Promise<SmsThreadRow[]> {
  const res = await apiRequestStream(`/api/phone/messages?limit=${limit}`, { auth: 'tenant' });
  return (await jsonOrThrow<{ rows: SmsThreadRow[] }>(res, 'Failed to load messages')).rows;
}

export async function fetchPhoneCalls(limit = 50): Promise<CallLogRow[]> {
  const res = await apiRequestStream(`/api/phone/calls?limit=${limit}`, { auth: 'tenant' });
  return (await jsonOrThrow<{ rows: CallLogRow[] }>(res, 'Failed to load calls')).rows;
}

export async function searchAvailableNumbers(
  query: { country?: string; areaCode?: string; contains?: string },
): Promise<AvailableNumber[]> {
  const params = new URLSearchParams();
  if (query.country) params.set('country', query.country);
  if (query.areaCode) params.set('areaCode', query.areaCode);
  if (query.contains) params.set('contains', query.contains);
  const res = await apiRequestStream(`/api/phone/numbers/available?${params}`, { auth: 'tenant' });
  return (await jsonOrThrow<{ rows: AvailableNumber[] }>(res, 'Failed to search numbers')).rows;
}

export async function purchaseNumber(e164: string, label?: string): Promise<ProvisionedNumber> {
  const res = await apiRequestStream('/api/phone/numbers', {
    method: 'POST', auth: 'tenant', body: JSON.stringify({ e164, label }),
  });
  return (await orRefuse<{ number: ProvisionedNumber }>(res, 'That number could not be bought')).number;
}

export async function releaseNumber(id: number): Promise<void> {
  const res = await apiRequestStream(`/api/phone/numbers/${id}`, { method: 'DELETE', auth: 'tenant' });
  await orRefuse<{ ok: boolean }>(res, 'That number could not be released');
}

export async function sendSms(to: string, body: string, from?: string): Promise<{ segments: number; costCents: number }> {
  const res = await apiRequestStream('/api/phone/sms', {
    method: 'POST', auth: 'tenant', body: JSON.stringify({ to, body, from }),
  });
  const sent = await orRefuse<{ message: { segments: number; costCents: number } }>(res, 'That message was not sent');
  return sent.message;
}

export async function fetchTopUpPacks(): Promise<TopUpPack[]> {
  const res = await apiRequestStream('/api/phone/topup/packs', { auth: 'tenant' });
  return (await jsonOrThrow<{ packs: TopUpPack[] }>(res, 'Failed to load credit packs')).packs;
}

/** Opens hosted checkout. Returns the URL to send the buyer to — this client does
 *  NOT navigate, so the caller keeps control of the redirect. */
export async function startTopUp(packId: string): Promise<string> {
  const res = await apiRequestStream('/api/phone/topup', {
    method: 'POST', auth: 'tenant', body: JSON.stringify({ packId }),
  });
  return (await orRefuse<{ checkoutUrl: string }>(res, 'Checkout could not be opened')).checkoutUrl;
}

/** Settles the session the processor redirected back with. Idempotent server-side,
 *  so a refresh of the success URL credits once. */
export async function completeTopUp(sessionId: string): Promise<{ applied: boolean; balanceCents: number; creditedCents: number }> {
  const res = await apiRequestStream('/api/phone/topup/complete', {
    method: 'POST', auth: 'tenant', body: JSON.stringify({ sessionId }),
  });
  return orRefuse(res, 'That payment could not be applied');
}
