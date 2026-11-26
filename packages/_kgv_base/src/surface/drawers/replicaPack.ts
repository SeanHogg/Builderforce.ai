/**
 * The replica's pack facts as words (PRD 41 A11 rule 6): the last pack's size (compressed, and as a percentage
 * of the same rows as JSON) and the parts sent and left. ONE reading for the Sync drawer's replica row and the
 * Run panel's, so they can never disagree. Pure.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import type { ReplicaState } from '../../types';

/** "12.4 MB", "830 KB", "312 B": the number in the reader's locale, the unit from the labels (so each language writes its own). */
export function packBytes(labels: KnowledgeGraphLabels, bytes: number): string {
    const t = labels.surface.sync;
    const num = (n: number): string => n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 1 : 0 });
    if (bytes >= 1024 * 1024) return fillTemplate(t.replicaUnitMB, { value: num(bytes / (1024 * 1024)) });
    if (bytes >= 1024) return fillTemplate(t.replicaUnitKB, { value: num(bytes / 1024) });
    return fillTemplate(t.replicaUnitB, { value: num(bytes) });
}

/** The last pack's line; null when nothing has been sent yet. */
export function replicaPackText(labels: KnowledgeGraphLabels, replica: ReplicaState): string | null {
    const p = replica.lastPack;
    if (!p) return null;
    return fillTemplate(labels.surface.sync.replicaPack, { size: packBytes(labels, p.bytes), percent: p.percent.toLocaleString(undefined, { maximumFractionDigits: 1 }), files: p.files.toLocaleString() });
}

/** "Sending part 2 of 5 (3 left)." while a multi-part pack is going; null otherwise. */
export function replicaPartsText(labels: KnowledgeGraphLabels, replica: ReplicaState): string | null {
    const p = replica.parts;
    if (!p || p.total < 2) return null;
    return fillTemplate(labels.surface.sync.replicaParts, { sent: Math.min(p.total, p.sent + 1), total: p.total, left: Math.max(0, p.total - p.sent - 1) });
}
