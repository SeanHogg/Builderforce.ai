/**
 * Idempotency helpers — the ids an outbox mints and the key a batch is sent under.
 *
 * Every entry gets an id when it is queued. A batch is SEALED the first time it is taken:
 * its entries are tagged with the batch's key (the first entry's id), so a retry, even
 * after a restart, re-sends exactly the same entries under exactly the same key.
 */
let fallbackCounter = 0;
/** Mint an entry id: `crypto.randomUUID()` where the host has it, else a unique fallback. */
export function defaultId() {
    const c = globalThis.crypto;
    if (c?.randomUUID)
        return c.randomUUID();
    fallbackCounter += 1;
    return `ob-${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
/** The `Idempotency-Key` a batch goes out under: its seal, or (unsealed) its head's id. */
export function batchIdempotencyKey(batch) {
    const head = batch[0];
    return head ? head.batch ?? head.id : undefined;
}
//# sourceMappingURL=idempotency.js.map