/**
 * chatDiagnosticsReads — the chat-scoped half of a diagnostics capture, wired ONCE.
 *
 * `gatherChatDiagnostics` is already the one assembler: every surface hands it the same
 * named readers and it produces the same report. What was NOT shared is how each host
 * produced those readers. The VS Code webview satisfied them from the chat-tickets REST
 * adapter; the web Brain panel satisfied the same three endpoints from a SECOND client
 * (`builderforceApi.listChatAgents` / `listChatTickets`). One assembler, two hand-wired
 * source sets over identical routes.
 *
 * That is not a cosmetic duplication. It is why adding the execution-history read meant
 * editing two hosts, and it is the shape a field-by-field drift takes: the moment one
 * host's client returns a field the other's does not, two "identical" reports quietly
 * describe different things — which is exactly the failure `gatherChatDiagnostics` was
 * extracted to end, stopped one layer short.
 *
 * So the reads live here, over the adapter both surfaces already build. A host keeps
 * only what genuinely differs between surfaces — its name, its build stamps, its plan
 * and Evermind readers — and a FOURTH chat-scoped read is added in this file alone.
 *
 * `chatId === null` is a real state (a chat that has not been created yet), and every
 * reader answers it with the empty shape rather than a throw the capture would have to
 * catch: a report about no chat is still a report.
 */

import type { ChatDiagnosticsSources } from '@seanhogg/builderforce-brain-embedded';
import type { ChatTicketsAdapter } from './types';

/** The reads this module owns — exactly the chat-scoped ones. */
export type ChatDiagnosticsChatReads = Pick<ChatDiagnosticsSources, 'readAgents' | 'readTickets' | 'readRuns'>;

/** Only the adapter methods these reads use, so a caller can pass a narrower object. */
export type ChatDiagnosticsReadAdapter = Pick<ChatTicketsAdapter, 'listAgents' | 'listTickets' | 'listRuns'>;

/**
 * The chat-scoped readers for a diagnostics capture, over the adapter the host already
 * has. Spread into `gatherChatDiagnostics({ ...chatDiagnosticsReads(adapter, chatId) })`.
 */
export function chatDiagnosticsReads(
  adapter: ChatDiagnosticsReadAdapter,
  chatId: number | null,
): ChatDiagnosticsChatReads {
  return {
    readAgents: () => (chatId != null ? adapter.listAgents(chatId) : Promise.resolve([])),
    readTickets: () => (chatId != null ? adapter.listTickets(chatId) : Promise.resolve([])),
    // WHAT ACTUALLY RAN. The two reads above describe INTENT — who was invited, what was
    // filed — and a chat can have both while nothing has ever executed. `null` means the
    // read did not happen, which the report states as "not gathered"; it must never be
    // confused with an empty history, which is the much stronger claim that nothing ran.
    readRuns: () => (chatId != null ? adapter.listRuns(chatId) : Promise.resolve(null)),
  };
}
