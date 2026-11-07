import { createCloudTranslate } from '@seanhogg/builderforce-brain-ui';
import { apiRequest } from './apiClient';

/**
 * The cloud translation fallback (PRD 42 · E4): `POST /api/translate`, ≤ 20 texts a call, on
 * the free Workers AI model within daily limits. A 429 (rate limited) or 503 (unavailable)
 * rejects, and the reader simply keeps the original. Anonymous callers are refused
 * server-side — the provider never hands them this function. The shared client batches the
 * calls and always sends the detected source language.
 */
export const cloudTranslate = createCloudTranslate((body) => apiRequest<{ translations: string[] }>('/api/translate', {
  method: 'POST',
  body: JSON.stringify(body),
  expectedErrors: [429, 503],
}));
