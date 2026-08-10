import { apiRequest } from './apiClient';

export type SalesStage = 'new' | 'contacted' | 'qualified' | 'meeting' | 'proposal' | 'won' | 'lost';
export type SalesContact = { id: string; ownerUserId: string; name: string; email: string; company: string; market: string; stage: SalesStage; lastTouchAt: string | null };
export type SalesCampaign = { id: string; ownerUserId: string; name: string; market: string; subject: string; status: 'draft' | 'scheduled' | 'active' | 'complete'; sent: number; replies: number };
export type SalesGoals = { outreachTarget: number; contactsTarget: number; meetingsTarget: number };
export type SalesNote = { id: string; body: string; createdAt: string; authorUserId: string; authorName: string | null };
export type SalesAssociate = { id: string; email: string; name: string | null; createdAt: string };
export type SalesWorkspace = { contacts: SalesContact[]; campaigns: SalesCampaign[]; goals: SalesGoals; notes: SalesNote[] };
export type SalesCommissionRule = { ruleKey: string; plan: 'pro' | 'teams'; billingCycle: 'monthly' | 'yearly'; referralBps: number; salesBps: number; updatedAt: string };
export type SalesPricing = { currency: string; pro: { monthly: number; yearly: number }; teams: { perSeatMonthly: number; perSeatYearly: number; minimumSeats: number } };

const query = (associateId?: string | null) => associateId ? `?associateId=${encodeURIComponent(associateId)}` : '';
const json = (body: unknown) => ({ method: 'POST', auth: 'web' as const, body: JSON.stringify(body) });

export const salesApi = {
  associates: () => apiRequest<{ associates: SalesAssociate[] }>('/api/sales/associates', { auth: 'web' }),
  canvas: (associateId?: string | null) => apiRequest<{ sessionId: string | null; referralCode: string | null; salesCode: string | null }>(`/api/sales/canvas${query(associateId)}`, { auth: 'web' }),
  setCanvas: (sessionId: string, associateId?: string | null) => apiRequest<{ sessionId: string }>(`/api/sales/canvas${query(associateId)}`, { method: 'PUT', auth: 'web', body: JSON.stringify({ sessionId }) }),
  workspace: (associateId?: string | null) => apiRequest<SalesWorkspace>(`/api/sales/workspace${query(associateId)}`, { auth: 'web' }),
  createContact: (body: Partial<SalesContact>, associateId?: string | null) => apiRequest<SalesContact>(`/api/sales/contacts${query(associateId)}`, json(body)),
  updateContact: (id: string, body: Partial<SalesContact>, associateId?: string | null) => apiRequest<SalesContact>(`/api/sales/contacts/${encodeURIComponent(id)}${query(associateId)}`, { ...json(body), method: 'PATCH' }),
  createCampaign: (body: Partial<SalesCampaign>, associateId?: string | null) => apiRequest<SalesCampaign>(`/api/sales/campaigns${query(associateId)}`, json(body)),
  updateCampaign: (id: string, body: Partial<SalesCampaign>, associateId?: string | null) => apiRequest<SalesCampaign>(`/api/sales/campaigns/${encodeURIComponent(id)}${query(associateId)}`, { ...json(body), method: 'PATCH' }),
  saveGoals: (body: SalesGoals, associateId?: string | null) => apiRequest<SalesGoals>(`/api/sales/goals${query(associateId)}`, { ...json(body), method: 'PUT' }),
  addNote: (associateId: string, body: string) => apiRequest<SalesNote>(`/api/sales/notes?associateId=${encodeURIComponent(associateId)}`, json({ body })),
  commissionRules: () => apiRequest<{ rules: SalesCommissionRule[]; pricing: SalesPricing }>('/api/sales/commission-rules', { auth: 'web' }),
  saveCommissionRules: (rules: Array<{ plan: string; billingCycle: string; referralPercent: number; salesPercent: number }>) => apiRequest<{ rules: SalesCommissionRule[]; pricing: SalesPricing }>('/api/sales/commission-rules', { method: 'PUT', auth: 'web', body: JSON.stringify({ rules }) }),
  claimReferral: (referralCode: string) => apiRequest<{ claimed: boolean }>('/api/sales/claim-referral', { method: 'POST', auth: 'web', body: JSON.stringify({ referralCode }) }),
};
