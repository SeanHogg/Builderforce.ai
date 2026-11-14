/**
 * The codec for every surface whose transcript is OpenAI chat-completion rows — the
 * cloud loop, the server Brain, the embedded Brain and the creation canvas. The tool
 * row's content is produced by the `serialize` the surface hands in, so payload
 * budgeting (the Brain trims, the cloud stringifies, the Brain reply slices) stays
 * with the surface while the ROW SHAPE lives here once.
 */
export function toOpenAiToolCall(call) {
    // An empty / whitespace-only `arguments` string is not valid JSON; strict vendors
    // (Gemini) reject it. Normalize a no-arg call to an empty object.
    return { id: call.id, type: "function", function: { name: call.name, arguments: call.arguments?.trim() ? call.arguments : "{}" } };
}
export const defaultToolRowSerializer = (result) => JSON.stringify(result.data ?? null);
function resolveSerializer(opts) {
    if (typeof opts === "function")
        return opts;
    if (opts?.serialize)
        return opts.serialize;
    const policy = opts?.toolResultPolicy;
    if (policy)
        return (result, call) => policy(call.name, result.data ?? null);
    return defaultToolRowSerializer;
}
/**
 * `M` is the surface's row type; it must be assignable FROM the assistant/tool rows
 * above (an `Array<Record<string, unknown>>` transcript qualifies).
 *
 * Takes the surface's serializer directly (the long-standing form), or options — where
 * `toolResultPolicy` opts the surface into the shared per-result budget.
 */
export function openAiChatCodec(serializeOrOptions) {
    const serialize = resolveSerializer(serializeOrOptions);
    return {
        assistant(turn) {
            const row = {
                role: "assistant",
                content: turn.content ?? "",
                tool_calls: turn.toolCalls.map(toOpenAiToolCall),
            };
            return row;
        },
        tool(call, result) {
            const row = { role: "tool", tool_call_id: call.id, content: serialize(result, call) };
            return row;
        },
    };
}
/** Reads the model's tool calls off an OpenAI-shape assistant message into the kernel's raw form. */
export function readOpenAiToolCalls(message) {
    const raw = message?.tool_calls;
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const tc of raw) {
        const fn = tc?.function;
        const name = typeof fn?.name === "string" ? fn.name : "";
        if (!name)
            continue;
        const idRaw = tc.id;
        const id = typeof idRaw === "string" && idRaw ? idRaw : `call_${out.length}`;
        const args = typeof fn?.arguments === "string" ? fn.arguments : fn?.arguments == null ? "" : JSON.stringify(fn.arguments);
        out.push({ id, name, arguments: args });
    }
    return out;
}
//# sourceMappingURL=openaiCodec.js.map