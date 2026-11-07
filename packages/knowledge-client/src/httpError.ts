/** The knowledge API's error answers as typed errors — shared by the main client and the sync client. */
import { KnowledgeApiError } from './types.js';

/** `{ error, code }` of a failed response as a {@link KnowledgeApiError} (a 429's `Retry-After` is kept as `retryAfterMs`). */
export async function errorOf(res: Response): Promise<KnowledgeApiError> {
  let code = `http_${res.status}`;
  let message = `knowledge API ${res.status}`;
  try {
    const body = (await res.json()) as { error?: unknown; code?: unknown };
    if (typeof body?.code === 'string') code = body.code;
    if (typeof body?.error === 'string') message = body.error;
  } catch {
    // A non-JSON error body keeps the status-derived code and message.
  }
  const seconds = Number(res.headers.get('retry-after'));
  const waitMs = res.status === 429 && res.headers.get('retry-after') != null && Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
  return new KnowledgeApiError(res.status, code, message, waitMs);
}
