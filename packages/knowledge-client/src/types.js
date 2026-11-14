/**
 * The knowledge API client contract (PRD 38 §4.8). One client for every host: the host
 * injects an authenticated `fetch` scoped to the API origin; the client owns paths,
 * payload shapes, bounds (≤ 500 rows per write) and error mapping.
 */
export class KnowledgeApiError extends Error {
    status;
    code;
    retryAfterMs;
    /** `retryAfterMs`: the server's `Retry-After` on a 429, uncapped (the replica pump waits it out). */
    constructor(status, code, message, retryAfterMs) {
        super(message);
        this.status = status;
        this.code = code;
        this.retryAfterMs = retryAfterMs;
        this.name = 'KnowledgeApiError';
    }
}
/** 409: the server moved (generation_mismatch), could not reach the digest (digest_mismatch) lacks a prior (prior_missing), lacks bodies (extracted_missing, `hashes` names them), lost a part (parts_missing) or saw another pack change the same bodies at the same time (body_conflict: rebuild and resend now). Reconcile or resend. */
export class KnowledgeSyncConflictError extends KnowledgeApiError {
    generation;
    digest;
    hashes;
    constructor(code, message, generation, digest, hashes) {
        super(409, code, message);
        this.generation = generation;
        this.digest = digest;
        this.hashes = hashes;
        this.name = 'KnowledgeSyncConflictError';
    }
}
/** 413: the request is over 8 MB or the pack inflates past 64 MB (pack_too_large). */
export class KnowledgeSyncTooLargeError extends KnowledgeApiError {
    constructor(code, message) { super(413, code, message); this.name = 'KnowledgeSyncTooLargeError'; }
}
/** 422: the frame is malformed or its CRC failed (bad_pack), or a tombstone named a key the root never synced (not_owned). A defect, not a retry. */
export class KnowledgeSyncBadPackError extends KnowledgeApiError {
    constructor(message, code = 'bad_pack') { super(422, code, message); this.name = 'KnowledgeSyncBadPackError'; }
}
//# sourceMappingURL=types.js.map