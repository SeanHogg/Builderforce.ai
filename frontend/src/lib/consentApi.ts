/**
 * The signed-in person's LEGAL CONSENT — what they have accepted and what they
 * still owe — over `/api/legal-documents/consent/*`.
 *
 * Its own client rather than a corner of `legalDocumentApi`: that module is
 * about the workspace's DOCUMENTS (uploads, shares, signatures); this one is
 * about a PERSON's standing against the platform's published kinds.
 */
import { apiRequest } from './apiClient';

export const DOCUMENT_KINDS = ['terms', 'privacy', 'dpa', 'aup', 'nda', 'cookie'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export interface ConsentAcceptance {
  documentKind: string;
  documentVersion: string;
  acceptedAt: string;
}

export interface ConsentOutstanding {
  outstanding: DocumentKind[];
  accepted: { documentKind: string; documentVersion: string }[];
}

export const consentApi = {
  /** Every acceptance with standing, newest first. */
  mine: (): Promise<ConsentAcceptance[]> =>
    apiRequest<{ acceptances: ConsentAcceptance[] }>('/api/legal-documents/consent/me').then((r) => r.acceptances ?? []),

  /** What is still owed among `required` — every kind when omitted. */
  outstanding: (required?: readonly DocumentKind[]): Promise<ConsentOutstanding> =>
    apiRequest<ConsentOutstanding>(
      `/api/legal-documents/consent/me/outstanding${required?.length ? `?required=${encodeURIComponent(required.join(','))}` : ''}`,
    ),
};
