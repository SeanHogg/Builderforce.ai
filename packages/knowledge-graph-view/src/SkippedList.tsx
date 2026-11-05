/**
 * The files a review or a sync did not store, each with the reason in words (nothing is dropped
 * without a trace). A size is shown only when it was measured; a missing one is left out, never
 * drawn as "0 B". Used by the done card (an expandable count) and the Sync drawer (the list).
 */

import { fillTemplate, camelKind, type KnowledgeGraphLabels } from './labels';
import { formatBytes } from './surface/drawers/syncModel';
import { muted } from './styles';
import type { SkippedFile } from './types';

export function skippedRowText(f: SkippedFile, labels: KnowledgeGraphLabels): string {
    const reasons: Record<string, string> = labels.surface.skipReasons;
    const reason = reasons[camelKind(f.reason)] ?? f.reason;
    const t = labels.surface.sync;
    return f.bytes === undefined
        ? fillTemplate(t.skippedRowNoSize, { path: f.path, reason })
        : fillTemplate(t.skippedRow, { path: f.path, size: formatBytes(f.bytes), reason });
}

export function SkippedItems({ items, labels, testId }: { items: readonly SkippedFile[]; labels: KnowledgeGraphLabels; testId?: string }) {
    return (
        <ul data-testid={testId} style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 4, fontSize: 12 }}>
            {items.map((f) => <li key={f.path} style={{ overflowWrap: 'anywhere' }}>{skippedRowText(f, labels)}</li>)}
        </ul>
    );
}

/** A count that opens into the list. */
export function SkippedUploads({ items, labels }: { items: readonly SkippedFile[]; labels: KnowledgeGraphLabels }) {
    if (items.length === 0) return null;
    return (
        <details data-testid="kg-skipped-uploads" style={muted}>
            <summary style={{ cursor: 'pointer', minHeight: 32 }}>{fillTemplate(labels.surface.skippedUploads, { count: items.length })}</summary>
            <SkippedItems items={items} labels={labels} testId="kg-skipped-uploads-list" />
        </details>
    );
}
