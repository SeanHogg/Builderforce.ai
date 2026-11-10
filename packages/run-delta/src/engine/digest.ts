/**
 * engine/digest.ts — `RunDelta.digest` (B8.2): sha256 (memory `sha256Hex`, pure) of the canonical
 * JSON (memory `canonicalJson`: sorted keys, `undefined` dropped) of the delta WITHOUT `narrative` and
 * `digest`, after EVERY number is quantized: a fixed decimal step per field
 * ({@link DIGEST_STEPS}, by field name; {@link DEFAULT_DIGEST_STEP} otherwise), serialized as an
 * integer of that step. A non-finite number serializes as `null`.
 *
 * Arrays are hashed in their stored order, which the engine has already sorted by declared keys, so
 * shuffled inputs and CRLF/LF texts give one digest.
 */

import { canonicalJson } from '@seanhogg/builderforce-memory/knowledge';
import { sha256Hex } from '@seanhogg/builderforce-memory/retrieval';
import { BLAST_RADIUS_STEP, type RunDelta } from '../contract.js';

/** Field name → decimal step. Counts and quantized metric values are integers at the default step too. */
export const DIGEST_STEPS: Readonly<Record<string, number>> = {
    score: BLAST_RADIUS_STEP,
    warn: 0.0001,
    error: 0.0001,
    p: 0.000001,
    ci: 0.000001,
    step: 1e-9,
};
export const DEFAULT_DIGEST_STEP = 0.000001;

function quantized(value: unknown, field: string): unknown {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return null;
        const q = Math.round(value / (DIGEST_STEPS[field] ?? DEFAULT_DIGEST_STEP));
        return q === 0 ? 0 : q; // no -0
    }
    if (Array.isArray(value)) return value.map((v) => quantized(v, field));
    if (value === null || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = quantized(v, k);
    return out;
}

/** The canonical, quantized form the digest hashes (exported for the property test). */
export function canonicalDelta(delta: Omit<RunDelta, 'digest' | 'narrative'> & { digest?: string; narrative?: unknown }): string {
    const { digest: _digest, narrative: _narrative, ...rest } = delta;
    return canonicalJson(quantized(rest, ''));
}

export function digestOf(delta: Omit<RunDelta, 'digest' | 'narrative'> & { digest?: string; narrative?: unknown }): string {
    return sha256Hex(canonicalDelta(delta));
}
