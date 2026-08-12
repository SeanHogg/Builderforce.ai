import { apiRequest } from './apiClient';
import type { CanvasResumeDocument } from './canvasResume';

export type ResumeImportResult = { document: CanvasResumeDocument; sourceFileKey: string | null; provider: string; model: string };

export async function importResumeSource(file: File, extractedText?: string): Promise<ResumeImportResult> {
  const form = new FormData();
  form.append('file', file);
  if (extractedText?.trim()) form.append('text', extractedText.slice(0, 80_000));
  return apiRequest<ResumeImportResult>('/api/creative/resume/import', { method: 'POST', body: form });
}
