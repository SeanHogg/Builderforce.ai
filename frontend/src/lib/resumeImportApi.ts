import { apiRequest } from './apiClient';
import type { CanvasResumeDocument } from './canvasResume';

export type ResumeImportResult = { document: CanvasResumeDocument; sourceFileKey: string | null; provider: string; model: string };

export async function importResumeSource(file: File, extractedText?: string): Promise<ResumeImportResult> {
  const form = new FormData();
  form.append('file', file);
  if (extractedText?.trim()) form.append('text', extractedText.slice(0, 80_000));
  return apiRequest<ResumeImportResult>('/api/creative/resume/import', { method: 'POST', body: form });
}

/**
 * Escalate a canvas attachment that was never a browser `File` in the first
 * place — its bytes already live in R2 (`sourceFileKey`, from a signed-in
 * drop) or inline as base64 (`sourceDataUrl`, from a local/guest canvas that
 * has since signed in). Exactly one of the two must be given.
 */
export async function importResumeFromAttachment(params: {
  fileName: string;
  sourceFileKey?: string;
  sourceDataUrl?: string;
}): Promise<ResumeImportResult> {
  const form = new FormData();
  form.append('fileName', params.fileName);
  if (params.sourceFileKey) form.append('sourceFileKey', params.sourceFileKey);
  if (params.sourceDataUrl) form.append('dataUrl', params.sourceDataUrl);
  return apiRequest<ResumeImportResult>('/api/creative/resume/import', { method: 'POST', body: form });
}
