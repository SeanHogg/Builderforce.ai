/**
 * The web Brain's half of "a diagnostics capture is data, not just prose".
 *
 * `BrainPanel`'s capture callback is already long, and what it needs here is two lines:
 * build the versioned report, store it, hand back the block to append. That is what this
 * is. The BUILDING lives in `@seanhogg/builderforce-brain-embedded`
 * (`buildChatDiagnosticsReport`) — shared with the VS Code copy path, so the two surfaces
 * persist the identical shape — and this only wires it to the web's API client.
 */

import {
  buildChatDiagnosticsReport,
  formatChatDiagnosticsReportJson,
  type BrainMessage,
  type BrainTraceEvent,
  type ChatDiagnosticsData,
  type ChatDiagnosticsReport,
} from '@seanhogg/builderforce-brain-embedded';

export interface CaptureDiagnosticsInput {
  diagnostics: ChatDiagnosticsData;
  events: BrainTraceEvent[];
  messages: BrainMessage[];
  model?: string | null;
  running?: boolean;
  chatId?: number | null;
  /** Persists the report. Rejections are swallowed here — see below. */
  store?: (chatId: number, report: ChatDiagnosticsReport) => Promise<unknown>;
}

/**
 * Build the report, store it best-effort, and return the Markdown block to append.
 *
 * The store is deliberately fire-and-forget: this whole feature exists to make an opaque
 * chat explainable, and a capture that reached the user has already done that whether or
 * not the row landed. Failing the copy because persistence failed would trade the
 * outcome that matters for the one that does not.
 */
export function captureDiagnosticsBlock(input: CaptureDiagnosticsInput): string {
  const report = buildChatDiagnosticsReport({
    diagnostics: input.diagnostics,
    events: input.events,
    messages: input.messages,
    model: input.model ?? null,
    running: input.running ?? false,
    surface: 'Web',
  });
  if (input.chatId != null && input.store) void input.store(input.chatId, report).catch(() => {});
  return formatChatDiagnosticsReportJson(report).join('\n');
}
