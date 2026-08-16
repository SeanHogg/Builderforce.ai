/**
 * Professional references — the typed client.
 *
 * Every authenticated call carries `auth: 'web'` — the PERSON's token, not the
 * workspace's. A reference belongs to a career, and the person keeping one may
 * have no workspace at all. `getSharedReferences` sends no credential: an employer
 * following the link has no account here, which is the whole point of the token.
 */
import { apiRequest } from '@/lib/apiClient';

export type ReferenceStatus = 'draft' | 'requested' | 'confirmed' | 'declined';

export interface ProfessionalReference {
  id: string;
  name: string;
  relationship: string | null;
  company: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  canSpeakTo: string | null;
  status: ReferenceStatus;
  requestedAt: string | null;
  confirmedAt: string | null;
  notes: string | null;
  createdAt: string | null;
}

export interface ReferenceShare {
  id: string;
  label: string | null;
  referenceIds: string[];
  includeContact: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string | null;
}

/** The create response — the only time the raw token is ever returned. */
export interface IssuedReferenceShare extends ReferenceShare {
  token: string;
}

export interface SharedReferenceView {
  label: string | null;
  includeContact: boolean;
  references: ProfessionalReference[];
}

export type ReferenceInput = Partial<Omit<ProfessionalReference, 'id' | 'createdAt' | 'requestedAt' | 'confirmedAt'>> & {
  name?: string;
};

export const referencesApi = {
  list: (): Promise<ProfessionalReference[]> =>
    apiRequest<{ references: ProfessionalReference[] }>('/api/references', { auth: 'web' }).then((r) => r.references),

  create: (input: ReferenceInput): Promise<ProfessionalReference> =>
    apiRequest<{ reference: ProfessionalReference }>('/api/references', {
      method: 'POST', auth: 'web', body: JSON.stringify(input),
    }).then((r) => r.reference),

  update: (id: string, input: ReferenceInput): Promise<ProfessionalReference> =>
    apiRequest<{ reference: ProfessionalReference }>(`/api/references/${encodeURIComponent(id)}`, {
      method: 'PATCH', auth: 'web', body: JSON.stringify(input),
    }).then((r) => r.reference),

  remove: (id: string): Promise<void> =>
    apiRequest<{ ok: true }>(`/api/references/${encodeURIComponent(id)}`, { method: 'DELETE', auth: 'web' }).then(() => undefined),

  listShares: (): Promise<ReferenceShare[]> =>
    apiRequest<{ shares: ReferenceShare[] }>('/api/references/shares', { auth: 'web' }).then((r) => r.shares),

  createShare: (input: { referenceIds: string[]; label?: string | null; includeContact?: boolean; expiresInDays?: number | null }): Promise<IssuedReferenceShare> =>
    apiRequest<{ share: IssuedReferenceShare }>('/api/references/shares', {
      method: 'POST', auth: 'web', body: JSON.stringify(input),
    }).then((r) => r.share),

  revokeShare: (id: string): Promise<void> =>
    apiRequest<{ ok: true }>(`/api/references/shares/${encodeURIComponent(id)}/revoke`, { method: 'POST', auth: 'web' }).then(() => undefined),
};

/** Public — what the holder of a share link sees. */
export const getSharedReferences = (token: string): Promise<SharedReferenceView> =>
  apiRequest<SharedReferenceView>(`/api/references/shared/${encodeURIComponent(token)}`, { auth: 'none' });
