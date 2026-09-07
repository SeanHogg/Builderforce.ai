/**
 * The VS Code webview's chat↔ticket adapter.
 *
 * The REST surface itself lives in `@seanhogg/builderforce-brain-ui`
 * (`createChatTicketsRestAdapter`) because the web app implements the same
 * endpoints against the same panel — this file used to be a second hand-written
 * copy, and it had lost the run's chat binding: a ticket dispatched from a VS
 * Code chat never invited the agent and never passed `chatId`, so the run
 * narrated nowhere and was unreachable from the conversation that asked for it.
 *
 * What is genuinely VS Code-specific is what remains here: the host-minted
 * bearer token and its 401 re-mint.
 */
import type { ChatTicketsAdapter } from '@seanhogg/builderforce-brain-ui';
import { createChatTicketsRestAdapter } from '@seanhogg/builderforce-brain-ui';
import { authedFetch } from './authedFetch';

export function createChatTicketsAdapter(
  baseUrl: string,
  getToken: () => string | null,
  onUnauthorized: () => void,
): ChatTicketsAdapter {
  // No `canRun`: the webview has no tenant-role context to answer with, so the
  // affordance stays enabled and the server refuses on its own authority — the
  // documented behaviour for a host that cannot answer the probe.
  return createChatTicketsRestAdapter({ request: authedFetch(baseUrl, getToken, onUnauthorized) });
}
