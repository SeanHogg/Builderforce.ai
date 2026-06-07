/**
 * Pure mapping from Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) stream
 * messages to BuilderForce's normalized agent events. The runner forwards these
 * onto the same wire frames the V1 (pi-coding-agent) loop emits — assistant
 * text, tool.audit, and terminal execution state — so the portal renders V1 and
 * V2 runs identically.
 *
 * Kept free of the SDK import so the shape mapping is unit-testable with plain
 * objects (the SDK spawns a CLI subprocess, which is impractical in a unit test).
 */

export type V2Event =
  | { kind: "assistant_text"; text: string }
  | { kind: "tool_use"; toolName: string; toolUseId: string; args: unknown }
  | { kind: "result"; ok: boolean; text: string; inputTokens: number; outputTokens: number }
  | { kind: "error"; message: string }
  | { kind: "system"; subtype: string };

interface ContentBlock {
  type?: string;
  text?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Map one SDK stream message to zero or more normalized events. Accepts
 * `unknown` and narrows defensively — unrecognized message types produce no
 * events (so new SDK message kinds never throw).
 */
export function mapSdkMessage(msg: unknown): V2Event[] {
  if (!msg || typeof msg !== "object") return [];
  const m = msg as Record<string, unknown>;
  const type = typeof m.type === "string" ? m.type : "";

  switch (type) {
    case "assistant": {
      const message = m.message as { content?: unknown } | undefined;
      const blocks = Array.isArray(message?.content) ? (message!.content as ContentBlock[]) : [];
      const out: V2Event[] = [];
      for (const b of blocks) {
        if (b?.type === "text" && typeof b.text === "string" && b.text.length > 0) {
          out.push({ kind: "assistant_text", text: b.text });
        } else if (b?.type === "tool_use") {
          out.push({
            kind: "tool_use",
            toolName: typeof b.name === "string" ? b.name : "unknown",
            toolUseId: typeof b.id === "string" ? b.id : "",
            args: b.input ?? {},
          });
        }
      }
      return out;
    }

    case "result": {
      const usage = (m.usage ?? {}) as Record<string, unknown>;
      const isError = m.subtype === "error" || m.is_error === true;
      return [
        {
          kind: "result",
          ok: !isError,
          text: typeof m.result === "string" ? m.result : "",
          inputTokens: num(usage.input_tokens),
          outputTokens: num(usage.output_tokens),
        },
      ];
    }

    case "system":
      return [{ kind: "system", subtype: typeof m.subtype === "string" ? m.subtype : "" }];

    default:
      return [];
  }
}
