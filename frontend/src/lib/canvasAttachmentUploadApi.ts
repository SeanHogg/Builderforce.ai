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
