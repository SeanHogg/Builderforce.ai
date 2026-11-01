/**
 * What a memory flush must not hide: a tenant governance gate refused a tool call it made.
 *
 * A flush writes the session's memory notes. When a gate refuses those writes the run still "finishes" (the model reads the
 * refusal and stops), so recording it as a flush that happened would tell the next turn its memory was saved when it was not.
 * A gate refusal reaches the run's tool events as an error result whose content is the gate's own structured answer
 * (`{ ok: false, gate, error }`, `policy/tools/gates.ts`), so the watch reads that field and no wording.
 */

interface ToolEvent {
  stream?: string;
  data?: Record<string, unknown>;
}

/** The gate id a tool-result event carries when a governance gate refused the call, else undefined. */
function refusingGate(evt: ToolEvent): string | undefined {
  if (evt.stream !== "tool" || evt.data?.phase !== "result" || evt.data.isError !== true) {
    return undefined;
  }
  const content = (evt.data.result as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  for (const block of content) {
    const text = (block as { type?: unknown; text?: unknown } | null)?.type === "text" ? (block as { text?: unknown }).text : undefined;
    if (typeof text !== "string") {
      continue;
    }
    try {
      const parsed = JSON.parse(text) as { gate?: unknown };
      if (typeof parsed?.gate === "string" && parsed.gate.length > 0) {
        return parsed.gate;
      }
    } catch {
      // not the gate's JSON answer: an ordinary tool error
    }
  }
  return undefined;
}

/** Feed it the flush run's agent events; ask it afterwards which gates refused the run's calls. */
export function watchFlushRefusals(): { observe: (evt: ToolEvent) => void; gates: () => string[] } {
  const gates = new Set<string>();
  return {
    observe: (evt) => {
      const gate = refusingGate(evt);
      if (gate) {
        gates.add(gate);
      }
    },
    gates: () => [...gates],
  };
}
