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

export const CHAT_DIAGNOSTICS_TOOLS: BuiltinTool[] = [
  {
    tool: 'chats.diagnostics',
    mutates: false,
    description:
      'The latest captured diagnostics for a Brain chat (verdict, likely cause, token/tool pressure, errors, staffing summary) — read this to learn why a previous run did not finish or did not dispatch anyone before repeating it. '
      + 'Each capture is a snapshot taken at the END of a run, so it carries facts the transcript does not: which model turns errored, how close the turn came to its token and tool budgets, and whether anybody was actually staffed to do the work. '
      + 'Pass limit > 1 to see whether the same cause is recurring rather than a one-off. '
      + 'An empty list means no capture has been stored for this chat — that is not evidence the run succeeded.',
    parameters: obj({ chatId: N, limit: N }, ['chatId']),
    run: async (ctx: BuiltinCtx, a: Json) => {
      const chatId = num(a.chatId);
      const limit = Math.max(1, Math.min(Number(a.limit) || 1, MAX_LIMIT));
      return replayRoute(ctx, 'GET', `/api/brain/chats/${chatId}/diagnostics?limit=${limit}`);
    },
  },
];
