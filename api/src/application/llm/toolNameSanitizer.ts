/**
 * Bidirectional tool-name sanitizer.
 *
 * Some vendors (Anthropic, some Cerebras configs) reject tool names that don't
 * match `^[a-zA-Z0-9_-]{1,64}$` — most notably they reject dots. Tenant apps
 * typically use dotted namespaces (`governance.snapshot`, `agile.kanban.list`)
 * so the gateway transparently sanitizes on the request path and restores on
 * the response path.
 *
 * The mapping is reversible because we use a sentinel (`__DOT__`) that is
 * vanishingly unlikely to occur in real tool names. If it ever does, the
 * round-trip preserves the original by escaping `__DOT__` itself.
 *
 * Applied uniformly across vendors — even those that accept dots — so the
 * mapping is symmetric and cooldown/failover never sees a mixed alphabet.
 */

const DOT_SENTINEL    = '__DOT__';
const ESCAPE_SENTINEL = '__DOT_ESC__';

export function sanitizeToolName(name: string): string {
  // Escape any pre-existing sentinel first, then replace dots.
  return name.replace(new RegExp(DOT_SENTINEL, 'g'), ESCAPE_SENTINEL).replace(/\./g, DOT_SENTINEL);
}

export function restoreToolName(name: string): string {
  // Restore in reverse order of escape.
  return name.replace(new RegExp(DOT_SENTINEL, 'g'), '.').replace(new RegExp(ESCAPE_SENTINEL, 'g'), DOT_SENTINEL);
}

// ─────────────────────────────────────────────────────────────────────────────
// Walkers — apply the (de)sanitizer to every tool-name location in the
// OpenAI-shape request/response. Single source so no caller needs to know
// which fields carry tool names.
// ─────────────────────────────────────────────────────────────────────────────

interface MaybeFunctionCarrier {
  type?: string;
  function?: { name?: string; [k: string]: unknown };
  [k: string]: unknown;
}

interface MaybeMessage {
  role?: string;
  content?: unknown;
  tool_calls?: Array<MaybeFunctionCarrier>;
  [k: string]: unknown;
}

/** Sanitize tool names in a request body before vendor dispatch. */
export function sanitizeRequestToolNames(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };

  if (Array.isArray(body.tools)) {
    out.tools = (body.tools as MaybeFunctionCarrier[]).map((t) => {
      if (t?.function?.name) {
        return { ...t, function: { ...t.function, name: sanitizeToolName(t.function.name) } };
      }
      return t;
    });
  }

  const tc = body.tool_choice as MaybeFunctionCarrier | string | undefined;
  if (tc && typeof tc !== 'string' && tc.function?.name) {
    out.tool_choice = { ...tc, function: { ...tc.function, name: sanitizeToolName(tc.function.name) } };
  }

  // Sanitize tool-call names already in the conversation history (assistant
  // tool-call turns) and any `name` field on `role: 'tool'` messages.
  if (Array.isArray(body.messages)) {
    out.messages = (body.messages as MaybeMessage[]).map((m) => {
      const next: MaybeMessage = { ...m };
      if (Array.isArray(m.tool_calls)) {
        next.tool_calls = m.tool_calls.map((tc) =>
          tc?.function?.name
            ? { ...tc, function: { ...tc.function, name: sanitizeToolName(tc.function.name) } }
            : tc,
        );
      }
      if (m.role === 'tool' && typeof m.name === 'string') {
        next.name = sanitizeToolName(m.name);
      }
      return next;
    });
  }

  return out;
}

/** Restore tool names in a vendor response so the caller sees their original dots. */
export function restoreResponseToolNames(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const out = { ...(raw as Record<string, unknown>) };
  const choices = (out.choices as Array<{ message?: MaybeMessage }> | undefined);
  if (Array.isArray(choices)) {
    out.choices = choices.map((c) => {
      const msg = c.message;
      if (!msg) return c;
      const tcs = msg.tool_calls;
      if (!Array.isArray(tcs)) return c;
      return {
        ...c,
        message: {
          ...msg,
          tool_calls: tcs.map((tc) =>
            tc?.function?.name
              ? { ...tc, function: { ...tc.function, name: restoreToolName(tc.function.name) } }
              : tc,
          ),
        },
      };
    });
  }
  return out;
}
