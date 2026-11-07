/**
 * Where the replica queue stands, as ONE reading (PRD 41 A7): the Sync drawer's headline and the copied
 * diagnostics both derive their sentence from {@link replicaPhase}, so they can never disagree. Pure.
 */

import type { ReplicaState } from '../../types';

export type ReplicaPhase =
    | { kind: 'waiting'; why: 'rate' | 'network' | 'server'; seconds: number }
    | { kind: 'paused'; why: 'auth' | 'unreachable' | 'project' }
    | { kind: 'sending' }
    | { kind: 'queued' }
    | { kind: 'idle' };

export function replicaPhase(replica: ReplicaState, now: number = Date.now()): ReplicaPhase {
    if (replica.paused) return { kind: 'paused', why: replica.paused };
    if (replica.waitingUntil !== undefined) {
        const why = replica.waitingFor === '429' ? 'rate' : replica.waitingFor === 'network' ? 'network' : 'server';
        return { kind: 'waiting', why, seconds: Math.max(0, Math.ceil((replica.waitingUntil - now) / 1000)) };
    }
    if (replica.sending) return { kind: 'sending' };
    return replica.queued > 0 ? { kind: 'queued' } : { kind: 'idle' };
}

/** A short reason for a failed op, by HTTP status (the raw text stays in the tooltip). */
export type ReplicaReason = 'auth' | 'badRequest' | 'tooLarge' | 'rateLimited' | 'server' | 'network' | 'other';

export function replicaReason(status: number | undefined): ReplicaReason {
    if (status === 401 || status === 403) return 'auth';
    if (status === 400) return 'badRequest';
    if (status === 413) return 'tooLarge';
    if (status === 429) return 'rateLimited';
    if (status === 0) return 'network';
    if (status !== undefined && status >= 500) return 'server';
    return 'other';
}

/** The English sentence the copied diagnostics print for a phase. */
export function replicaPhaseEnglish(phase: ReplicaPhase, retryAt?: number): string {
    switch (phase.kind) {
        case 'waiting': return `waiting (${phase.why}, retry in ${phase.seconds}s${retryAt !== undefined ? ` at ${new Date(retryAt).toISOString()}` : ''})`;
        case 'paused': return `paused (${phase.why})`;
        case 'sending': return 'sending';
        case 'queued': return 'queued';
        case 'idle': return 'idle';
    }
}
