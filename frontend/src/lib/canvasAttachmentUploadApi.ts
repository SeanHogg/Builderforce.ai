import { apiRequest } from './apiClient';

/**
 * Upload a canvas attachment's bytes to R2 so a file the browser could not read
 * (a scanned PDF, a corrupted document) can still be escalated to a server-side
 * read later. Signed-in, tenant-owned sessions only — there is no tenant to
 * scope the upload to, or bill a later OCR read to, on a local/guest canvas.
 */
export async function uploadAttachmentSource(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const { sourceFileKey } = await apiRequest<{ sourceFileKey: string }>('/api/creative/attachments/upload', { method: 'POST', body: form });
  return sourceFileKey;
}

/**
 * READ a retained attachment that the browser could not.
 *
 * The other half of the escalation the upload above exists for. `uploadAttachmentSource`
 * has been keeping the bytes of every unreadable drop since it shipped, and nothing ever
 * read through the door it opened — so a scanned contract stayed an attachment card
 * forever. This is the read: the server hands the file to the multimodal pool with an OCR
 * use case and returns Markdown, which the canvas turns into a `document`.
 *
 * `dataUrl` is the guest path: a local session keeps its attachment inline rather than in
 * R2, so once there is a tenant to bill the read to, the bytes go up with the request.
 */
export interface AttachmentRead {
  markdown: string;
  fileName: string;
  sourceFileKey: string | null;
  model: string | null;
}

export async function readAttachmentSource(input: {
  sourceFileKey?: string;
  dataUrl?: string;
  fileName?: string;
}): Promise<AttachmentRead> {
  return apiRequest<AttachmentRead>('/api/creative/attachments/read', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}
