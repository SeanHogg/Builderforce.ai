/**
 * FILES on a posting or a proposal — metadata here, bytes streamed from the API.
 *
 * Its own module because it is the only part of the marketplace that handles
 * binary at all: an upload is multipart rather than JSON, and a download is a
 * short-lived object URL the caller must revoke. Both differ enough from the rest
 * of the typed client that folding them into `postings.ts` hid them.
 *
 * Transport, and why it is not `fetch`: see `./transport`.
 */
import { getStoredWebToken } from '@/lib/auth';
import { apiRequestStream, jsonOrThrow } from './transport';
import type { PostingAttachment } from './postings';

// ---- Attachments (0985) --------------------------------------------------
//
// Uploaded to the SAME R2 bucket the résumé and avatar uploads use — there is no second
// blob store, and there is deliberately no direct-to-bucket URL: an attachment is served
// only after its id has been found on a row the caller is entitled to read.

export async function uploadJobAttachment(jobId: string, file: File): Promise<{ attachment: PostingAttachment; attachments: PostingAttachment[] }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await apiRequestStream(`/api/jobs/${jobId}/attachments`, { method: 'POST', auth: 'tenant', body: fd });
  return jsonOrThrow(res, 'Failed to attach file');
}

/**
 * Fetch one attachment's bytes and hand back an object URL.
 *
 * NOT an `<a href>` to the API route: the attachment endpoints are authenticated, and a
 * plain link carries no Bearer token — it would 401 for the very people entitled to the
 * file. Fetching through the same transport as every other call and wrapping the blob is
 * what makes "open the brief" work for a signed-in client and impossible for anybody
 * else. The caller MUST revoke the URL when it is finished with it.
 */
async function attachmentObjectUrl(path: string, auth: 'tenant' | 'web'): Promise<string> {
  const res = await apiRequestStream(path, { auth });
  if (!res.ok) throw new Error('Failed to open attachment');
  return URL.createObjectURL(await res.blob());
}

/** A posting's brief. As public as the posting's description — a bidder who can read the
 *  scope must be able to read the spec they are being asked to price. */
export function openJobAttachment(jobId: string, attachmentId: string): Promise<string> {
  return attachmentObjectUrl(`/api/jobs/${jobId}/attachments/${attachmentId}`, 'web');
}

export function openProposalAttachmentAsEmployer(jobId: string, proposalId: string, attachmentId: string): Promise<string> {
  return attachmentObjectUrl(`/api/jobs/${jobId}/proposals/${proposalId}/attachments/${attachmentId}`, 'tenant');
}

/** The BIDDER reading back their own work sample. */
export function openMyProposalAttachment(proposalId: string, attachmentId: string): Promise<string> {
  return attachmentObjectUrl(`/api/jobs/proposals/${proposalId}/attachments/${attachmentId}`, 'web');
}

export async function deleteJobAttachment(jobId: string, attachmentId: string): Promise<{ attachments: PostingAttachment[] }> {
  const res = await apiRequestStream(`/api/jobs/${jobId}/attachments/${attachmentId}`, { method: 'DELETE', auth: 'tenant' });
  return jsonOrThrow(res, 'Failed to remove attachment');
}

export async function uploadProposalAttachment(proposalId: string, file: File): Promise<{ attachment: PostingAttachment; attachments: PostingAttachment[] }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await apiRequestStream(`/api/jobs/proposals/${proposalId}/attachments`, { method: 'POST', auth: 'web', body: fd });
  return jsonOrThrow(res, 'Failed to attach file');
}

export async function deleteProposalAttachment(proposalId: string, attachmentId: string): Promise<{ attachments: PostingAttachment[] }> {
  const res = await apiRequestStream(`/api/jobs/proposals/${proposalId}/attachments/${attachmentId}`, { method: 'DELETE', auth: 'web' });
  return jsonOrThrow(res, 'Failed to remove attachment');
}

