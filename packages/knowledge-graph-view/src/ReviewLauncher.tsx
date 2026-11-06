/**
 * "Review a folder": one button when the host has one way to pick a folder, else the
 * host's targets (this workspace, a folder on this device, a connected drive). Each press
 * starts the review INSIDE the click — a picker that needs the gesture opens there.
 *
 * The same actions also render as menu items (`reviewActions`, the header's ⋯ menu), so the
 * two never disagree about what a press starts.
 */

import { useEffect, useRef, useState } from 'react';
import type { KnowledgeGraphLabels } from './labels';
import { button, primaryButton } from './styles';
import type { MenuItem } from './surface/ui';
import type { KnowledgeGraphSource, ReviewRequest, ReviewTarget } from './types';
import type { ReviewState } from './useReviewRun';

/** Whether a review is already underway (planning, awaiting confirm, or running): the press is spent. */
export const reviewBusy = (status: ReviewState['status'] | undefined): boolean => status === 'planning' || status === 'confirm' || status === 'running';

/** The places the host can review; empty until it answers (or when it names none). */
export function useReviewTargets(source: KnowledgeGraphSource): ReviewTarget[] {
    const [targets, setTargets] = useState<ReviewTarget[]>([]);
    useEffect(() => {
        let live = true;
        source.targets?.().then((t) => { if (live) setTargets(t); }).catch(() => undefined);
        return () => { live = false; };
    }, [source]);
    return targets;
}

/** What pressing the review action for one target (or for "pick a folder") starts. */
const requestFor = (target: ReviewTarget | undefined): ReviewRequest => (target ? { target: target.id } : { pick: true });

const REVIEW_PREFIX = 'review:';

/**
 * The review actions as menu items: one per target (or the single "Review a folder" when the host
 * has at most one), plus "Re-review this folder" when a folder is open. `request(id)` is what
 * pressing an item starts; null for an id that is not a review item.
 */
export function reviewActions(args: {
    source: KnowledgeGraphSource;
    labels: KnowledgeGraphLabels;
    targets: readonly ReviewTarget[];
    busy: boolean;
    /** The open folder; present ⇒ the re-review item is offered. */
    rootId: string | null;
}): { items: MenuItem[]; request(id: string): ReviewRequest | null } {
    const { source, labels, targets, busy, rootId } = args;
    if (!source.review) return { items: [], request: () => null };
    const many = targets.length > 1;
    const items: MenuItem[] = many
        ? targets.map((t) => ({ id: `${REVIEW_PREFIX}${t.id}`, label: `${labels.reviewFolder} · ${labels.targets[t.kind]}${t.title ? ` · ${t.title}` : ''}`, disabled: busy }))
        : [{ id: `${REVIEW_PREFIX}`, label: labels.reviewFolder, disabled: busy }];
    if (rootId) items.push({ id: 'rereview', label: labels.surface.header.reReview, disabled: busy });
    return {
        items,
        request: (id) => {
            if (id === 'rereview') return rootId ? { rootId } : {};
            if (!id.startsWith(REVIEW_PREFIX)) return null;
            return requestFor(many ? targets.find((t) => `${REVIEW_PREFIX}${t.id}` === id) : targets[0]);
        },
    };
}

export interface ReviewLauncherProps {
    source: KnowledgeGraphSource;
    labels: KnowledgeGraphLabels;
    start(req: ReviewRequest): void;
    primary?: boolean;
    /** Arrive on it: its targets shown and the button focused (a host's "Choose a folder to review" chip). */
    defaultOpen?: boolean;
    /** The run's status: while a review is underway the button shows it is busy instead of offering to start again. */
    status?: ReviewState['status'];
}

export function ReviewLauncher({ source, labels, start, primary = true, defaultOpen = false, status }: ReviewLauncherProps) {
    const targets = useReviewTargets(source);
    const [open, setOpen] = useState(defaultOpen);
    const buttonRef = useRef<HTMLButtonElement>(null);
    // Focus only: the picker itself still needs the person's own press (a gesture).
    useEffect(() => { if (defaultOpen) buttonRef.current?.focus(); }, [defaultOpen]);

    if (!source.review) return null;
    const style = primary ? primaryButton : button;
    // A review already underway: say so on the button rather than letting it look idle (the plan can take a while).
    const busy = reviewBusy(status);
    if (targets.length <= 1) {
        return (
            <button
                ref={buttonRef} type="button" style={style} disabled={busy} aria-busy={busy}
                onClick={() => start(requestFor(targets[0]))}
            >
                {busy ? labels.reviewPlanning : labels.reviewFolder}
            </button>
        );
    }
    return (
        <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
            <button
                ref={buttonRef} type="button" style={style} aria-expanded={open} disabled={busy} aria-busy={busy}
                onClick={() => setOpen((v) => !v)}
            >
                {busy ? labels.reviewPlanning : labels.reviewFolder}
            </button>
            {open && (
                <ul aria-label={labels.reviewTargetsLabel} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                    {targets.map((t) => (
                        <li key={t.id}>
                            <button type="button" style={{ ...button, whiteSpace: 'normal', textAlign: 'start' }} onClick={() => { setOpen(false); start(requestFor(t)); }}>
                                {labels.targets[t.kind]}{t.title ? ` · ${t.title}` : ''}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
