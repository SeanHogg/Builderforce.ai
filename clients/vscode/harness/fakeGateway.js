/**
 * A scripted stand-in for the gateway's streaming completion endpoint.
 *
 * The VSIX's chat is the run loop in `@seanhogg/builderforce-brain-embedded` talking to
 * ONE injected function: `stream(opts, handlers)`. Everything downstream of that — tool
 * dispatch, stall recovery, model failover, context compaction, the trace the "Copy
 * diagnostics" button serializes — is deterministic given the sequence of completions
 * that function returns.
 *
 * So a fake `stream` that returns a SCRIPTED sequence reproduces any chat failure in
 * milliseconds, offline, with no VSIX build, no install, no gateway account and no
 * tokens spent. That is the whole point of this file: the reported failures ("it
 * narrates a tool call and dies", "it answers without the data") are model-BEHAVIOUR
 * failures, and model behaviour is exactly what a script can state directly.
 *
 * The fake is faithful in the ways the loop can observe: it streams text through
 * `onTextDelta` in chunks (so the run store's streaming buffer, the XML tool-call
 * filter's hold-back logic and time-to-first-token all exercise their real paths),
 * honours the abort signal, and reports usage / finish reason / resolved model /
 * account headers in the same shapes the real client surfaces.
 */
import { XmlToolCallFilter, isCoderReask } from '@seanhogg/builderforce-brain-embedded';
/** How many characters of text to emit per streamed delta. Deliberately small so a
 *  tag straddles chunk boundaries and the XML filter's hold-back path is exercised. */
const CHUNK = 7;
function textOf(content) {
    if (typeof content === 'string')
        return content;
    return content
        .map((p) => (p.type === 'text' ? p.text : ''))
        .join(' ');
}
function lastUserText(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user')
            return textOf(messages[i].content);
    }
    return '';
}
function toolNamesOf(tools) {
    return (tools ?? []).map((t) => t.function.name);
}
function assemble(calls, turn) {
    return (calls ?? []).map((c, i) => ({
        id: c.id ?? `call_${turn}_${i}`,
        name: c.name,
        args: typeof c.args === 'string' ? c.args : JSON.stringify(c.args ?? {}),
    }));
}
/**
 * Build a fake gateway from a script.
 *
 * Turns beyond the end of a fixed-array script repeat the LAST entry. That is not a
 * convenience: the failures worth testing are the ones where a model does the same
 * unhelpful thing on every turn until the loop's budget runs out, and a script that
 * silently ran dry would end the run for the wrong reason.
 *
 * The analysis→code hand-off ({@link isCoderReask}) re-asks the current turn of the
 * coding model, which given the same transcript makes the same move — so that request
 * REPLAYS the current step rather than consuming the next one.
 */
export function fakeGateway(script) {
    const requests = [];
    let turn = 0;
    let lastRole;
    const stream = async (opts, handlers) => {
        const advertised = toolNamesOf(opts.tools);
        const reask = isCoderReask(opts.role, lastRole);
        lastRole = opts.role;
        if (reask)
            turn -= 1;
        const ctx = {
            turn,
            requestedModel: opts.model,
            advertised,
            messages: opts.messages,
            toolless: opts.tools === undefined,
        };
        requests.push({
            turn,
            requestedModel: opts.model,
            advertised,
            toolless: ctx.toolless,
            messageCount: opts.messages.length,
            lastUserText: lastUserText(opts.messages),
        });
        turn += 1;
        const spec = typeof script === 'function'
            ? script(ctx)
            : (script[ctx.turn] ?? script[script.length - 1] ?? { text: '' });
        if (spec.throws)
            throw spec.throws;
        // Raw model output goes through the SAME inline-dialect filter the real streaming
        // client runs, so a script whose "model" writes `<tool_call>…` markup exercises the
        // real lifting path (and the caller sees only the cleaned text). A harness whose
        // transport were kinder than the product's would prove nothing about the product.
        const xml = new XmlToolCallFilter();
        const raw = spec.text ?? '';
        for (let i = 0; i < raw.length; i += CHUNK) {
            if (opts.signal?.aborted)
                throw new DOMException('Aborted', 'AbortError');
            const clean = xml.push(raw.slice(i, i + CHUNK));
            if (clean)
                handlers?.onTextDelta?.(clean);
            // Yield to the microtask queue so an abort issued mid-stream is observed, exactly
            // as it would be between two real SSE frames.
            await Promise.resolve();
        }
        const tail = xml.flush();
        if (tail)
            handlers?.onTextDelta?.(tail);
        const text = xml.cleanText();
        // Native calls first, lifted inline ones as the fallback — the client's ordering.
        const toolCalls = [...assemble(spec.toolCalls, ctx.turn), ...xml.toolCalls()];
        const finishReason = spec.finishReason !== undefined
            ? spec.finishReason
            : toolCalls.length > 0 ? 'tool_calls' : 'stop';
        handlers?.onDone?.(finishReason);
        return {
            text,
            toolCalls,
            finishReason,
            ...(spec.resolvedModel !== undefined ? { resolvedModel: spec.resolvedModel } : {}),
            ...(spec.usage ? { usage: spec.usage } : {}),
            ...(spec.account !== undefined ? { account: spec.account } : {}),
            ...(spec.byoUnresolved !== undefined ? { byoUnresolved: spec.byoUnresolved } : {}),
            ...(spec.providerCap !== undefined ? { providerCap: spec.providerCap } : {}),
        };
    };
    return { stream, requests };
}
//# sourceMappingURL=fakeGateway.js.map