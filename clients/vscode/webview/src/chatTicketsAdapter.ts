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
import type { ChatQuestionVM, ChatTicketsAdapter, TicketLinkVM } from '@seanhogg/builderforce-brain-ui';
import { chatQuestionsReader, createChatTicketsRestAdapter } from '@seanhogg/builderforce-brain-ui';
import { authedFetch } from './authedFetch';

/** The platform adapter, plus the questions filter over a link list the caller already holds. */
export interface ChatTicketsPlatform {
  adapter: ChatTicketsAdapter;
  questionsFor(links: readonly TicketLinkVM[]): Promise<ChatQuestionVM[]>;
}

export function createChatTicketsPlatform(
  baseUrl: string,
  getToken: () => string | null,
  onUnauthorized: () => void | Promise<void>,
): ChatTicketsPlatform {
  const request = authedFetch(baseUrl, getToken, onUnauthorized);
  // No `canRun`: the webview has no tenant-role context to answer with, so the
  // affordance stays enabled and the server refuses on its own authority — the
  // documented behaviour for a host that cannot answer the probe.
  return { adapter: createChatTicketsRestAdapter({ request }), questionsFor: chatQuestionsReader(request) };
}
