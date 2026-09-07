/**
 * The `/api/brain` REST client — ONE implementation, both hosts.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * This surface was written twice, method for method: `frontend/src/lib/
 * builderforceApi.ts` for the web app and `clients/vscode/webview/src/
 * persistence.ts` for the VS Code webview. Same endpoints, same query-string
 * building, same `attachEvermindLearn` fold — and they had already drifted:
 * `deleteChat`'s and `markChatRead`'s return types disagreed, and the
 * `evermindLearn` envelope was typed structurally in one copy and by its real
 * `EvermindLearnOutcome` in the other. A drift in a return type is invisible
 * until a caller reads the field the other copy never had.
 *
 * ── WHAT IS INJECTED, AND WHY ONLY THAT ─────────────────────────────────────
 * The two hosts differ in exactly three ways, so exactly three things are
 * parameters:
 *   • `request` — how an authenticated JSON call is made. The web app's goes
 *     through its cached/refreshing `apiRequest`; the webview's is `authedFetch`,
 *     which re-mints the host token on a 401.
 *   • `baseUrl` — needed for the two URL BUILDERS and the SSE subscription,
 *     which construct absolute URLs rather than issuing a `request`.
 *   • `getToken` — the SSE subscription and the multipart upload authenticate
 *     themselves; neither can go through `request`.
 * Everything else is the wire contract, and the wire contract has one owner.
 *
 * The returned object is deliberately NOT widened to `BrainPersistenceAdapter`:
 * the web app's `brain` client exposes the richer response types (`{ archived }`,
 * `{ lastReadSeq }`) and spreads extra non-adapter methods alongside them. Typing
 * the factory's return precisely is what lets ONE definition serve both a strict
 * adapter and a richer client without a second copy — and it satisfies the
 * adapter interface structurally, which the compiler checks at each call site.
 */
import { subscribeToChatMessages } from './chatMessageSubscription';
import { attachEvermindLearn } from './types';
import type { BrainChat, BrainMessage, EvermindLearnOutcome } from './types';

/**
 * An authenticated JSON call, relative to the gateway origin.
 *
 * The init is narrowed to what this client actually sends — a method and a body —
 * rather than the whole of `RequestInit`. Demanding more than it uses would
 * reject a perfectly good host request function over a `headers` type it never
 * passes, which is exactly what the web app's `apiRequest` (whose `headers` is a
 * plain record) would have hit.
 */
export type BrainRestInit = { method?: string; body?: BodyInit };
export type BrainRestRequest = <T>(path: string, init?: BrainRestInit) => Promise<T>;

export interface BrainRestOptions {
  /** Absolute gateway origin — used for the URL builders and the SSE subscription. */
  baseUrl: string;
  /** How this host makes an authenticated JSON call. */
  request: BrainRestRequest;
  /** Bearer token accessor, for the two calls that authenticate themselves. */
  getToken: () => string | null;
  /**
   * Multipart upload, when the host's `request` cannot carry a `FormData` body
   * with its boundary intact.
   *
   * The web app's `apiRequest` leaves `Content-Type` unset for `FormData`, so it
   * needs no override. The webview's `authedFetch` always sets
   * `application/json`, which would strip the multipart boundary and make every
   * upload fail — so it passes its own. This is the difference that made a
   * shared implementation look impossible; naming it makes it one line.
   */
  uploadFile?: (file: File) => Promise<{ key: string; name: string; type: string }>;
}

/** Build the `?a=b` suffix for a chat listing, or '' when nothing is set. */
function listQuery(params?: { projectId?: string; limit?: number; offset?: number }): string {
  const q = new URLSearchParams();
  if (params?.projectId) q.set('projectId', params.projectId);
  if (params?.limit != null) q.set('limit', String(params.limit));
  if (params?.offset != null) q.set('offset', String(params.offset));
  const query = q.toString();
  return query ? `?${query}` : '';
}

export function createBrainRestPersistence(opts: BrainRestOptions) {
  const { baseUrl, request, getToken } = opts;

  return {
    listChats: (params?: { projectId?: string; limit?: number; offset?: number }) =>
      request<{ chats: BrainChat[] }>(`/api/brain/chats${listQuery(params)}`).then((r) => r.chats),

    getChat: (id: number) => request<BrainChat>(`/api/brain/chats/${id}`),

    createChat: (body: { title?: string; projectId?: number | null; capability?: string | null; mode?: string | null }) =>
      request<BrainChat>('/api/brain/chats', { method: 'POST', body: JSON.stringify(body) }),

    updateChat: (
      id: number,
      body: { title?: string; projectId?: number | null; visibility?: 'shared' | 'locked'; capability?: string | null; mode?: string | null },
    ) => request<BrainChat>(`/api/brain/chats/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

    /** Archives rather than destroys — `archived` is what the server reports. */
    deleteChat: (id: number) =>
      request<{ archived: boolean }>(`/api/brain/chats/${id}`, { method: 'DELETE' }),

    /** Summarize a chat and store the summary on it. */
    summarizeChat: (id: number) =>
      request<{ summary: string } | { error: string }>(`/api/brain/chats/${id}/summarize`, { method: 'POST' }),

    getMessages: (chatId: number, limit?: number) =>
      request<{ messages: BrainMessage[] }>(
        `/api/brain/chats/${chatId}/messages${limit != null ? `?limit=${limit}` : ''}`,
      ).then((r) => r.messages),

    subscribeMessages: (chatId: number, onChanged: () => void) =>
      subscribeToChatMessages(baseUrl, getToken, chatId, onChanged),

    /**
     * Advance this viewer's unread high-water mark (omit `seq` for "all read").
     *
     * Reading a chat in VS Code clears its badge on the web too — it is the same
     * server conversation. Best-effort: the run loop never blocks on it.
     */
    markChatRead: (chatId: number, seq?: number) =>
      request<{ lastReadSeq: number }>(`/api/brain/chats/${chatId}/read`, {
        method: 'POST',
        body: JSON.stringify(seq != null ? { seq } : {}),
      }),

    /**
     * Post turns, and attach the server's TRUTHFUL learn-gate outcome to the
     * assistant turn(s) this POST persisted.
     *
     * The outcome is transient — it is never persisted — so a host that drops it
     * renders a run that is silent about learning, which is exactly how
     * "Connected, yet nothing learned" became an unexplained mystery in the VSIX.
     * Folding it HERE is what stops one host from forgetting again.
     */
    sendMessages: (chatId: number, messages: Array<{ role: string; content: string; metadata?: string }>) =>
      request<{ messages: BrainMessage[]; evermindLearn?: EvermindLearnOutcome }>(
        `/api/brain/chats/${chatId}/messages`,
        { method: 'POST', body: JSON.stringify({ messages }) },
      ).then((r) => attachEvermindLearn(r.messages, r.evermindLearn)),

    /**
     * Set thumbs up/down on a message (null clears).
     *
     * `context.toolName` is the MCP tool the rated turn ran — the server files it,
     * with the reply's resolved model, as an `llm_action_ratings` row the learned
     * router ranks on. So the press teaches routing, not just a button colour.
     */
    setMessageFeedback: (messageId: number, feedback: 'up' | 'down' | null, context?: { toolName?: string | null }) =>
      request<{ ok: boolean }>(`/api/brain/messages/${messageId}/feedback`, {
        method: 'PATCH',
        body: JSON.stringify({ feedback, toolName: context?.toolName ?? null }),
      }),

    /**
     * Ask an invited agent participant to reply — a chat-scoped run that answers
     * AS the agent, returning the posted assistant turn (attributed through
     * `metadata.authoredBy`).
     */
    requestAgentReply: (chatId: number, input: { agentRef: string; agentName?: string }) =>
      request<{ message: BrainMessage }>(`/api/brain/chats/${chatId}/agent-reply`, {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((r) => r.message),

    upload: (file: File): Promise<{ key: string; name: string; type: string }> => {
      if (opts.uploadFile) return opts.uploadFile(file);
      const form = new FormData();
      form.append('file', file);
      return request<{ key: string; name: string; type: string }>('/api/brain/upload', { method: 'POST', body: form });
    },

    /** URL to view/download an uploaded file by key. */
    uploadUrl: (key: string) => `${baseUrl}/api/brain/uploads/${key}`,

    /**
     * Mint a short-lived signed public URL for an uploaded object so an upstream
     * LLM provider can fetch it (vision). Used only for an image too large to
     * inline as a data URL — see the image prep in the run loop.
     */
    signedUploadUrl: async (key: string): Promise<string> => {
      const { exp, sig } = await request<{ exp: number; sig: string }>('/api/brain/uploads/sign', {
        method: 'POST',
        body: JSON.stringify({ key }),
      });
      return `${baseUrl}/api/brain-files/${key}?exp=${exp}&sig=${encodeURIComponent(sig)}`;
    },
  };
}

/** The precise shape {@link createBrainRestPersistence} returns. */
export type BrainRestPersistence = ReturnType<typeof createBrainRestPersistence>;
