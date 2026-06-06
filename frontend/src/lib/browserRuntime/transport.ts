/**
 * Concrete BrowserRuntimeTransport backed by the BuilderForce API.
 *
 *  - claim()     → POST /api/agent-runtime/claim
 *  - callModel() → POST /v1/chat/completions   (the user's own model via gateway)
 *  - report()    → POST /api/agent-runtime/:id/result   (drives autonomous advance)
 *
 * The HTTP primitive is injected (defaults to the app's authenticated apiRequest)
 * so this is unit-testable with a fake — and so the same transport works in a
 * WebContainer or a plain tab.
 */
import { apiRequest } from '../apiClient';
import type { BrowserRuntimeTransport, ClaimedDispatch, ModelCall } from './runner';

type RequestFn = <T>(path: string, opts?: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<T>;

interface ClaimResponse {
  dispatch:
    | {
        dispatchId: string;
        claimToken: string;
        role: string;
        model: string | null;
        input: string | null;
        taskId: number | null;
        ticketRunId: string;
        repo?: { repoId: string; defaultBranch: string | null } | null;
      }
    | null;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export function createBrowserAgentTransport(deps: { request?: RequestFn } = {}): BrowserRuntimeTransport {
  const request: RequestFn = deps.request ?? ((path, opts) => apiRequest(path, opts));

  return {
    async claim(): Promise<ClaimedDispatch | null> {
      const res = await request<ClaimResponse>('/api/agent-runtime/claim', { method: 'POST', body: '{}' });
      if (!res.dispatch) return null;
      return {
        dispatchId: res.dispatch.dispatchId,
        model: res.dispatch.model,
        role: res.dispatch.role,
        input: res.dispatch.input,
        taskId: res.dispatch.taskId,
        repo: res.dispatch.repo ?? null,
      };
    },

    async callModel(call: ModelCall): Promise<string> {
      const res = await request<ChatCompletionResponse>('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: call.model,
          messages: [{ role: 'user', content: call.prompt }],
        }),
      });
      const content = res.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new Error('Gateway returned no completion content.');
      }
      return content;
    },

    async report(dispatchId, result): Promise<void> {
      await request(`/api/agent-runtime/${encodeURIComponent(dispatchId)}/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      });
    },

    async openPullRequest(dispatchId, pr): Promise<{ url: string; number: number } | null> {
      try {
        const res = await request<{ url?: string; number?: number }>(
          `/api/agent-runtime/${encodeURIComponent(dispatchId)}/pull-request`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pr) },
        );
        if (typeof res.url === 'string' && typeof res.number === 'number') {
          return { url: res.url, number: res.number };
        }
        return null;
      } catch {
        // Provider unsupported / PR step failed — the branch is pushed regardless,
        // so don't fail the whole dispatch; the summary notes the branch.
        return null;
      }
    },
  };
}
