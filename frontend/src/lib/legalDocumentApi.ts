/**
 * THE client for the legal-document surface (`legalDocumentRoutes.ts`).
 *
 * Mirrors `founderOpsApi.ts`'s shape: one module, going through `apiRequest` — the
 * transport with the header contract (emulation token, locale, error dispatch) —
 * rather than a second fetch wrapper that quietly drops it.
 *
 * `uploadLegalDocumentFile` is the one function here that is NOT called from a
 * `BrainAction`: a browser `File` cannot cross the JSON tool-call boundary, so it is
 * called directly from `CanvasLegalDocumentUpload.tsx`, a real UI control, exactly as
 * `uploadAttachmentSource` in `canvasAttachmentUploadApi.ts` already is for the
 * canvas's other multipart upload.
 */

import { apiRequest, getApiBaseUrl } from '@/lib/apiClient';
import { LEGAL_DOCUMENT_CATEGORIES, type LegalDocumentCategory } from '@/lib/legalObjects';

export { LEGAL_DOCUMENT_CATEGORIES, type LegalDocumentCategory };

export type LegalDocumentStatus = 'draft' | 'shared' | 'awaiting_signature' | 'declined' | 'signed';

export interface LegalDocumentArtifact {
  id: string;
  title: string;
  mime: string | null;
  byteSize: number | null;
  checksum: string | null;
}

/** The shape `GET /api/legal-documents/:id` returns. `status`/`signedAt` are computed
 *  on every read — see `legalDocumentStore.ts` — never write them from here. */
export interface LegalDocumentDetail {
  id: string;
  title: string;
  category: string;
  entityId: number | null;
  matterId: number | null;
  ipId: number | null;
  objectId: string | null;
  signatureRequestId: number | null;
  createdAt: string;
  updatedAt: string;
  artifact: LegalDocumentArtifact | null;
  status: LegalDocumentStatus;
  signedAt: string | null;
  activeShares: number;
}

export const getLegalDocument = (documentId: string) =>
  apiRequest<{ document: LegalDocumentDetail }>(`/api/legal-documents/${encodeURIComponent(documentId)}`)
    .then((r) => r.document);

export interface ShareLegalDocumentBody {
  permission?: 'view' | 'download';
  recipientEmail?: string;
  expiresAt?: string;
}

export interface CreatedLegalDocumentShare {
  shareId: string;
  /** The plaintext share credential, returned EXACTLY once — only its hash is
   *  stored, the same rule the signature and form invitation tokens follow. A caller
   *  that drops this has to revoke and re-share to issue a new one. */
  token: string;
  permission: 'view' | 'download';
  expiresAt: string | null;
}

export const shareLegalDocument = (documentId: string, body: ShareLegalDocumentBody) =>
  apiRequest<CreatedLegalDocumentShare>(`/api/legal-documents/${encodeURIComponent(documentId)}/share`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const revokeLegalDocumentShare = (shareId: string) =>
  apiRequest<{ ok: true }>(`/api/legal-documents/shares/${encodeURIComponent(shareId)}/revoke`, { method: 'POST' });

export interface RequestLegalDocumentSignatureBody {
  subject: string;
  intent?: string;
  expiresAt?: string;
  remindAfterDays?: number;
  parties: Array<{ name: string; email: string; partyRef?: string | null }>;
}

export interface CreatedLegalDocumentSignatureRequest {
  requestId: number;
  status: string;
  invitations: Array<{ partyId: number; name: string; email: string; token: string }>;
}

export const requestLegalDocumentSignature = (documentId: string, body: RequestLegalDocumentSignatureBody) =>
  apiRequest<CreatedLegalDocumentSignatureRequest>(`/api/legal-documents/${encodeURIComponent(documentId)}/request-signature`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export interface UploadLegalDocumentFields {
  title: string;
  category?: LegalDocumentCategory;
  entityId?: number | null;
  matterId?: number | null;
  ipId?: number | null;
  /** The canvas object this upload lands on. */
  objectId?: string | null;
  /** Pass an EXISTING `legal_document_files.id` to attach a new VERSION rather than
   *  create a new document — see `legalDocumentStore.ts`'s "why re-upload never
   *  overwrites". */
  documentId?: string | null;
}

export interface UploadedLegalDocument {
  documentId: string;
  artifactId: string;
  checksum: string;
}

// ---------------------------------------------------------------------------
// The recipient's read — no session, the token in the path is the credential
// ---------------------------------------------------------------------------

export interface PublicLegalDocumentShare {
  title: string;
  permission: 'view' | 'download';
  mime: string | null;
  filename: string;
}

/** What `/legal-documents/shared/:token` reads before rendering anything —
 *  same "resolve the token first" shape as `publicForm`/`signerView`. */
export const publicLegalDocumentShare = (token: string) =>
  apiRequest<{ document: PublicLegalDocumentShare }>(`/api/public/legal-documents/${encodeURIComponent(token)}`)
    .then((r) => r.document);

/**
 * The direct file URL for a share token — 'view' renders inline (a PDF opens
 * in-tab), 'download' forces a save dialog; the SERVER decides which via
 * `Content-Disposition`, so this is just the address, not a fetch. A plain
 * `<a href>`/`<iframe src>` is deliberately preferred over a JS fetch+blob
 * dance: the browser already knows how to stream, preview and save a file, and
 * re-implementing that for an unauthenticated visitor buys nothing.
 */
export function legalDocumentShareFileUrl(token: string): string {
  return `${getApiBaseUrl()}/api/public/legal-documents/${encodeURIComponent(token)}/download`;
}

/** Real `multipart/form-data`, direct to `/api/legal-documents` — never through
 *  Brain's JSON tool-call path, because a browser `File` cannot be a tool parameter. */
export async function uploadLegalDocumentFile(file: File, fields: UploadLegalDocumentFields): Promise<UploadedLegalDocument> {
  const form = new FormData();
  form.append('file', file);
  form.append('title', fields.title);
  if (fields.category) form.append('category', fields.category);
  if (fields.entityId != null) form.append('entityId', String(fields.entityId));
  if (fields.matterId != null) form.append('matterId', String(fields.matterId));
  if (fields.ipId != null) form.append('ipId', String(fields.ipId));
  if (fields.objectId) form.append('objectId', fields.objectId);
  if (fields.documentId) form.append('documentId', fields.documentId);
  return apiRequest<UploadedLegalDocument>('/api/legal-documents', { method: 'POST', body: form });
}
