/**
 * knowledge/gatewayError.ts - the message of a non-OK `/llm/v1/chat/completions` body, in ONE
 * place for every client that calls the gateway (the web's `parseLlmError`, Rovr's pinpoint).
 * Two envelopes: the gateway's own `{ error: "message", code }` and the OpenAI-shaped
 * passthrough `{ error: { message, type, code } }`.
 */
export function gatewayErrorMessage(body, fallback) {
    const error = body?.error;
    if (typeof error === 'string')
        return error || fallback;
    if (error && typeof error === 'object' && 'message' in error)
        return String(error.message ?? '') || fallback;
    return fallback;
}
//# sourceMappingURL=gatewayError.js.map