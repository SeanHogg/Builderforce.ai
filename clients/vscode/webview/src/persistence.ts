/**
 * The VS Code webview's Brain persistence.
 *
 * The `/api/brain` REST surface itself lives in `brain-embedded`
 * (`createBrainRestPersistence`) because the web app implements exactly the same
 * endpoints — this file used to be a method-for-method second copy of it, and the
 * two had already drifted on `deleteChat`'s and `markChatRead`'s return types.
 * What is genuinely VS Code-specific is what remains here: the host-minted token,
 * the 401 re-mint, and the multipart upload `authedFetch` cannot carry.
 *
 * The webview talks to the API directly (CORS allows the `vscode-webview://`
 * origin), so a VS Code chat is the exact same server-side conversation as on the
 * web: one unified brain.
 */

import type { BrainPersistenceAdapter } from '@seanhogg/builderforce-brain-embedded';
import { createBrainRestPersistence } from '@seanhogg/builderforce-brain-embedded';
import { authedFetch } from './authedFetch';

export function createPersistence(
  baseUrl: string,
  getToken: () => string | null,
  onUnauthorized: () => void,
): BrainPersistenceAdapter {
  const req = authedFetch(baseUrl, getToken, onUnauthorized);

  return createBrainRestPersistence({
    baseUrl,
    request: req,
    getToken,
    /**
     * `authedFetch` always sets `Content-Type: application/json`, which would
     * strip the multipart boundary and fail every upload — so the one call that
     * needs a raw body issues its own `fetch`. It still honours the 401 signal so
     * an expired host token surfaces the same way as on every other call.
     */
    uploadFile: async (file) => {
      const token = getToken();
      const form = new FormData();
      form.append('file', file);
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${baseUrl}/api/brain/upload`, { method: 'POST', headers, body: form });
      if (res.status === 401) onUnauthorized();
      if (!res.ok) throw new Error((await res.text().catch(() => '')) || 'Upload failed');
      return (await res.json()) as { key: string; name: string; type: string };
    },
  });
}
