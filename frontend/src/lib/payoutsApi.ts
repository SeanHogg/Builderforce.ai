import { apiRequest } from './apiClient';

/**
 * The payout-destination client — `/api/payouts`.
 *
 * Mirrors the server port exactly: a provider is either an OAuth grant
 * (`connect: 'oauth'`, navigate to `authUrl`) or a form (`connect: 'fields'`,
 * POST the values). No surface branches on the provider NAME — Stripe and a bank
 * account differ by their declared `connect`, which is the whole reason the
 * descriptor carries it.
 */

export type PayoutProviderName = 'stripe' | 'paypal' | 'bank' | 'wise';

export interface PayoutField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
}

export interface PayoutProviderDescriptor {
  name: PayoutProviderName;
  label: string;
  blurb: string;
  connect: 'oauth' | 'fields';
  fields: PayoutField[];
  configured: boolean;
}

export interface PayoutAccount {
  id: number;
  provider: PayoutProviderName;
  label: string;
  currency: string | null;
  country: string | null;
  status: string;
  isDefault: boolean;
  lastError: string | null;
  lastPayoutAtISO: string | null;
  connectedAtISO: string;
}

export interface PayoutRecord {
  id: number;
  amountCents: number;
  status: string;
  provider: string;
  reference: string | null;
  memo: string | null;
  externalRef: string | null;
  occurredAtISO: string;
}

export interface PayoutBalance {
  earnedCents: number;
  paidCents: number;
  availableCents: number;
}

export const payoutsApi = {
  providers: () => apiRequest<{ providers: PayoutProviderDescriptor[]; connections: PayoutAccount[] }>('/api/payouts/providers'),
  connectUrl: (provider: PayoutProviderName, returnTo: string) =>
    apiRequest<{ authUrl: string }>(`/api/payouts/connect/${provider}?returnTo=${encodeURIComponent(returnTo)}`),
  connectFields: (provider: PayoutProviderName, fields: Record<string, string>, makeDefault = false) =>
    apiRequest<PayoutAccount>('/api/payouts/connections', {
      method: 'POST', body: JSON.stringify({ provider, fields, makeDefault }),
    }),
  setDefault: (id: number) => apiRequest<PayoutAccount>(`/api/payouts/connections/${id}/default`, { method: 'PUT' }),
  disconnect: (id: number) => apiRequest<{ ok: true }>(`/api/payouts/connections/${id}`, { method: 'DELETE' }),
  history: () => apiRequest<{ payouts: PayoutRecord[]; paidCents: number }>('/api/payouts/history'),
};
