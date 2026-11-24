/**
 * The CHAT DIAGNOSTICS tool — "why did that run not finish?", spread into
 * `builtinMcpService`'s `CATALOG`.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * A run that stops without finishing, or finishes without dispatching anyone, leaves the
 * next turn with nothing to read but the transcript it already has. So the model does the
 * only thing available: it repeats the attempt. Measured on VS Code chat #113 — three
 * coordination tools refused in a row, and each following turn tried the same call again,
 * because nothing in the vocabulary could answer "what went wrong last time?".
 *
 * The client already COMPUTES that answer at capture time (`ChatDiagnosticsReport` —
 * verdict, likely cause, token and tool pressure, error steps, staffing summary) and
 * `POST /api/brain/chats/:id/diagnostics` stores it. This row is the read side: one tool
 * so a model can consult the verdict BEFORE repeating the run that produced it.
 *
 * ── WHY IT IS ITS OWN CATALOG MODULE ─────────────────────────────────────────────
 * `builtinMcpService` is already ~4,200 lines, and the convention for anything that can
 * declare its own rows is to declare them in its own module and be spread in — the career
 * and delivery tools both do. This follows it rather than adding another line to the file
 * everyone has to edit.
 *
 * ── REPLAY, DON'T RE-READ ────────────────────────────────────────────────────────
 * The run goes through `replayRoute` rather than calling the store, so the tool inherits
 * the route's access check (`brainService.canAccess`) and its cached read. A tool that
 * queried the table directly would be a second, quieter answer to "may this caller see
 * this chat?".
 */
import { replayRoute, type BuiltinCtx, type BuiltinTool } from './builtinToolContext';

type Json = Record<string, unknown>;

// --- tiny JSON-schema helpers (same shapes the main catalog uses) ------------
const N = { type: 'number' } as const;
const obj = (properties: Json, required: string[] = []): Json => ({ type: 'object', properties, required });
const num = (v: unknown): number => Number(v);

/** Captures one call may pull back. The store keeps 25 per chat; a model asking "what
 *  went wrong" wants the last verdict, occasionally the last few to see a pattern. */
const MAX_LIMIT = 25;

function record(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
}

/** Bounded facts for the agent. The authenticated diagnostics endpoint keeps the full capture. */
export function summarizeDiagnosticCaptures(value: unknown): Json {
  const response = record(value);
  if (!Array.isArray(response.diagnostics)) return response;
  const diagnostics = response.diagnostics.map((value: unknown) => {
    const capture = record(value);
    const report = record(capture.report);
    const run = record(report.run);
    return {
      id: capture.id,
      chatId: capture.chatId,
      surface: capture.surface,
      schemaVersion: capture.schemaVersion,
      capturedAt: capture.capturedAt,
      likelyCause: capture.likelyCause,
      running: report.running,
      contextPressureOnly: run.contextPressureOnly,
      promptTokenPeak: run.promptTokenPeak,
      truncatedToolResults: run.truncatedToolResults,
      errors: run.errors,
      modelFailovers: run.modelFailovers,
      outcome: run.outcome,
      sessionWork: run.sessionWork,
      ...(Number(capture.schemaVersion) >= 3 ? { sessionShipped: run.sessionShipped } : {}),
      provenance: report.provenance,
      staffing: Object.fromEntries(Object.entries(record(report.staffing)).filter(([key]) =>
        ['ticketsCreated', 'filedLocally', 'dispatched', 'verdict'].includes(key))),
      providerFailure: run.providerFailure,
      specValidation: run.specValidation,
      errorSteps: Array.isArray(run.errorSteps) ? run.errorSteps.slice(-3) : undefined,
    };
  });
  return {
    diagnostics,
    evidence: diagnostics.length ? 'stored_snapshots' : 'no_capture',
    note: diagnostics.length
      ? 'These are stored snapshots. Use capturedAt and running before drawing conclusions about the current run.'
      : 'Nothing has been captured yet. The current run’s health and recurring failure patterns are unknown.',
  };
}

export const CHAT_DIAGNOSTICS_TOOLS: BuiltinTool[] = [
  {
    tool: 'chats.diagnostics',
    mutates: false,
    description:
      'The latest captured diagnostics for a Brain chat (verdict, likely cause, token/tool pressure, errors, staffing summary) — read this to learn why a previous run did not finish or did not dispatch anyone before repeating it. '
      + 'Captures are snapshots and can have been taken while a run was still executing. Check capturedAt and running before inferring anything about the current run. '
      + 'Pass limit > 1 to see whether the same cause is recurring rather than a one-off. '
      + 'An empty list means no capture has been stored for this chat — that is not evidence the run succeeded.',
    parameters: obj({ chatId: N, limit: N }, ['chatId']),
    run: async (ctx: BuiltinCtx, a: Json) => {
      const chatId = num(a.chatId);
      const limit = Math.max(1, Math.min(Number(a.limit) || 1, MAX_LIMIT));
      return summarizeDiagnosticCaptures(await replayRoute(ctx, 'GET', `/api/brain/chats/${chatId}/diagnostics?limit=${limit}`));
    },
  },
];
