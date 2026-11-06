/**
 * The status strip's "⋯ More actions" menu: Review a folder / Re-review (the launcher's own
 * actions), Before / After when the host keeps a baseline, Copy diagnostics (with its "Copied"
 * note). The folder picker is NOT here: the spine's root crumb is its one place. The review
 * confirm flow is unchanged: a press starts a review and the plan card asks before anything is written.
 */

import type { KnowledgeGraphLabels } from '../labels';
import { CopiedNote, useCopyText } from '../copyText';
import { reviewActions, reviewBusy } from '../ReviewLauncher';
import type { Revision } from '../revision';
import type { KnowledgeGraphSource, ReviewRequest, ReviewTarget } from '../types';
import type { ReviewState } from '../useReviewRun';
import { Menu, type MenuItem } from './ui';

export interface OverflowMenuProps {
    source: KnowledgeGraphSource;
    labels: KnowledgeGraphLabels;
    /** The open folder, if a graph is on screen (offers Re-review). */
    rootId: string | null;
    /** Whether review actions are offered at all (a graph is on screen, or its read failed). */
    canReview: boolean;
    reviewStatus: ReviewState['status'];
    onReview(req: ReviewRequest): void;
    /** Present when the host keeps a baseline: which graph is drawn, and whether "before" exists. */
    revision?: { value: Revision; hasBefore: boolean; onChange(r: Revision): void } | undefined;
    diagnosticsText(): string;
    /** The places the host can review (`useReviewTargets`, read ONCE by the root and shared with the empty state's launcher). */
    targets: readonly ReviewTarget[];
    /** Arrive on the review action (a host's "Choose a folder to review" chip): the menu opens focused on it. */
    openReview?: boolean | undefined;
}

export function OverflowMenu({ source, labels, rootId, canReview, reviewStatus, onReview, revision, diagnosticsText, targets, openReview }: OverflowMenuProps) {
    const copier = useCopyText();
    const h = labels.surface.header;
    const review = reviewActions({ source, labels, targets, busy: reviewBusy(reviewStatus), rootId });

    const items: MenuItem[] = [
        ...(canReview ? review.items : []),
        ...(revision ? [
            { id: 'rev:before', label: labels.compareBefore, sub: labels.revisionLabel, disabled: !revision.hasBefore, selected: revision.value === 'before' },
            { id: 'rev:after', label: labels.compareAfter, sub: labels.revisionLabel, selected: revision.value === 'after' },
        ] : []),
        { id: 'copy', label: labels.copyDiagnostics },
    ];

    const onSelect = (id: string) => {
        if (id === 'copy') { void copier.copy(diagnosticsText()); return; }
        if (id === 'rev:before' || id === 'rev:after') { revision?.onChange(id === 'rev:before' ? 'before' : 'after'); return; }
        const req = review.request(id);
        if (req) onReview(req);
    };

    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <CopiedNote status={copier.status} labels={labels} />
            <Menu
                // Keyed on whether review is offered: the menu mounts before the graph loads, and `defaultOpen` is read once.
                key={canReview ? 'review' : 'plain'} defaultOpen={openReview === true && canReview && review.items.length > 0}
                trigger={(
                    <>
                        <span aria-hidden="true">⋯</span>
                        <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{h.moreActions}</span>
                    </>
                )}
                label={h.moreActions} title={h.moreActions} items={items} onSelect={onSelect}
            />
        </span>
    );
}
