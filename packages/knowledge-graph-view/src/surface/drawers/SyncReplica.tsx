/**
 * The Sync drawer's replica row (PRD 41 A7): the linked root's third reading, beside "local" and
 * "server". The map is drawn from the local store; this says what of it the project has not
 * received yet — dirty keys, the last pack's size and the parts left, sending, waiting out a rate limit (a live countdown), paused (signed out, the
 * server unreachable) or failed. Op kinds and reasons are in the person's words; the raw text stays in
 * the tooltip. Nothing here can change the map.
 */

import { useEffect, useState } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { muted } from '../../styles';
import type { ReplicaState } from '../../types';
import { counted } from '../plural';
import { relativeTime } from '../syncPill';
import { replicaPhase, replicaReason, type ReplicaReason } from './replicaState';
import { replicaPackText, replicaPartsText } from './replicaPack';
import { Section } from './ui';

const REASON_LABEL: Record<ReplicaReason, 'replicaReasonAuth' | 'replicaReasonBadRequest' | 'replicaReasonTooLarge' | 'replicaReasonRate' | 'replicaReasonServer' | 'replicaReasonNetwork' | 'replicaReasonOther'> = {
    auth: 'replicaReasonAuth', badRequest: 'replicaReasonBadRequest', tooLarge: 'replicaReasonTooLarge', rateLimited: 'replicaReasonRate',
    server: 'replicaReasonServer', network: 'replicaReasonNetwork', other: 'replicaReasonOther',
};

/** The one line that says where the queue stands. */
export function replicaHeadline(labels: KnowledgeGraphLabels, replica: ReplicaState, now: number = Date.now()): string {
    const t = labels.surface.sync;
    const phase = replicaPhase(replica, now);
    switch (phase.kind) {
        case 'waiting': {
            const why = phase.why === 'rate' ? t.replicaWhy429 : phase.why === 'network' ? t.replicaWhyNetwork : t.replicaWhyServer;
            return fillTemplate(t.replicaWaiting, { reason: why, seconds: phase.seconds });
        }
        case 'paused': return phase.why === 'auth' ? t.replicaPausedAuth : phase.why === 'unreachable' ? t.replicaPausedUnreachable : t.replicaPausedProject;
        case 'sending': return t.replicaSending;
        case 'queued': return counted(labels, 'replicaQueued', replica.dirty);
        case 'idle': return t.replicaIdle;
    }
}

export function SyncReplica({ replica, labels }: { replica: ReplicaState; labels: KnowledgeGraphLabels }) {
    const t = labels.surface.sync;
    const waiting = replica.waitingUntil !== undefined;
    // The retry countdown ticks every second while the pump waits.
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!waiting) return undefined;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [waiting]);
    const busy = replica.sending || waiting || !!replica.paused;
    const partsText = replicaPartsText(labels, replica), packText = replicaPackText(labels, replica);
    return (
        <Section title={t.replicaTitle}>
            <div data-testid="kg-sync-replica" data-queued={replica.dirty} style={{ display: 'grid', gap: 4 }}>
                <span role="status">{replicaHeadline(labels, replica, now)}</span>
                {busy && replica.dirty > 0 && <span style={muted}>{counted(labels, 'replicaQueued', replica.dirty)}</span>}
                {partsText && <span data-testid="kg-sync-replica-parts" style={muted}>{partsText}</span>}
                {packText && <span data-testid="kg-sync-replica-pack" style={muted}>{packText}</span>}
                {replica.failed.length > 0 && (
                    <div data-testid="kg-sync-replica-failed" style={{ display: 'grid', gap: 2 }}>
                        <span role="alert">{counted(labels, 'replicaFailed', replica.failed.length)}</span>
                        {replica.failed.map((f, i) => (
                            <span key={i} style={muted} title={f.reason}>
                                {fillTemplate(t.replicaFailedRow, { reason: t[REASON_LABEL[replicaReason(f.status)]] })}
                            </span>
                        ))}
                    </div>
                )}
                {replica.lastSyncAt && relativeTime(replica.lastSyncAt) && <span style={muted}>{fillTemplate(t.replicaLastSync, { time: relativeTime(replica.lastSyncAt) })}</span>}
            </div>
        </Section>
    );
}
