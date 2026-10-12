/**
 * The fields of the Brain (`chat`) object that MIRROR the live turn — its transcript,
 * its tool trace and the run state behind its activity bar — and the one rule about
 * them: they are a projection of session state, not an edit anybody made.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────
 * The board's history checkpoint records every settled board change as an undo step
 * and as a `user/object.edit` journal row. The mirror rewrites the chat object after
 * every tool call, so a single build turn pushed one undo step and one "user" row per
 * call. Measured (session `local-148925cf`, ui 2026.10.45): 37 `object.edit` rows
 * interleaved with the turn's own tool rows, attributed to the person, and an undo
 * depth of 21 — pressing Undo stepped back through the Brain's trace instead of
 * through anything the person did.
 *
 * The writer ({@link brainMirrorData}) and the reader ({@link withoutBrainMirror}) live
 * together so the set of mirror fields cannot drift between them.
 */

/** The chat-object fields the live-turn mirror owns. */
export const BRAIN_MIRROR_FIELDS = ['messages', 'trace', 'brainRunning', 'brainRunStartedAt', 'aiResponse'] as const;

type BrainMirrorField = typeof BRAIN_MIRROR_FIELDS[number];

/** A transcript row as the Brain object stores it. */
export interface BrainMirrorMessage {
  role: string;
  content: string;
  createdAt: string;
}

/**
 * The mirror fields for the chat object, from the live turn. `trace` is set only when
 * the turn has one, so a finished run's trace stays on the object until the next run
 * produces its own.
 */
export function brainMirrorData(input: {
  timeline: ReadonlyArray<{ messageRole: string; body: string; createdAt: string }>;
  trace: readonly unknown[];
  running: boolean;
  runStartedAt: number | null;
  priorAiResponse: unknown;
}): Partial<Record<BrainMirrorField, unknown>> {
  const messages: BrainMirrorMessage[] = input.timeline.map((message) => ({
    role: message.messageRole, content: message.body, createdAt: message.createdAt,
  }));
  const lastAnswer = [...input.timeline].reverse().find((message) => message.messageRole === 'assistant')?.body;
  return {
    messages,
    ...(input.trace.length ? { trace: input.trace } : {}),
    brainRunning: input.running,
    brainRunStartedAt: input.runStartedAt,
    aiResponse: lastAnswer || input.priorAiResponse,
  };
}

interface GraphNodeShape { id: string; data?: object }

/**
 * The board with every chat object's mirror fields removed — what the history
 * checkpoint compares, so a change confined to the mirror is not an undo step.
 * Only `chat` objects are stripped: another kind's `messages` field is its own content.
 */
export function withoutBrainMirror<G extends { nodes: GraphNodeShape[] }>(graph: G): G {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const record = node.data as Record<string, unknown> | undefined;
      if (record?.kind !== 'chat') return node;
      const data = { ...record };
      for (const field of BRAIN_MIRROR_FIELDS) delete data[field];
      return { ...node, data };
    }),
  } as G;
}
