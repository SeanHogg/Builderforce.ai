/**
 * The view's ONE port: `KnowledgeGraphSource` (PRD 38 §4.6). A host decides only where
 * files come from and where memory is persisted; the view never imports a host adapter.
 *
 * ── THE REVIEW CONFIRM HANDSHAKE ─────────────────────────────────────────────────
 * Review writes memory, so the confirm chip is mandatory (§4.3). The handshake is:
 *
 *   1. The view calls `review(req, ctl)` SYNCHRONOUSLY inside the person's click — a
 *      host whose picker needs a user gesture (`<input webkitdirectory>`) opens it there.
 *   2. The source walks the folder (`planReview`: a walk plus a manifest diff, no reads
 *      of unchanged files) and YIELDS `{ type: 'plan', plan, estimate? }`. The view
 *      renders the chip: files by pack, unchanged files, ≈ model calls (≈ cost when the
 *      estimate carries one).
 *   3. The source then AWAITS `ctl.confirm(plan)`. The view resolves it from the chip:
 *      Confirm → `true`; Cancel → `false`; *Re-review all* → `false`, after which the
 *      view starts a NEW review with `force: true` (the manifest is ignored, so every
 *      file is planned as changed).
 *   4. `false` ⇒ the source yields `{ type: 'cancelled' }` and returns, having written
 *      nothing. `true` ⇒ it runs `reviewDirectory`, yielding `{ type: 'progress' }` per
 *      step, then `{ type: 'done', report }`.
 *   5. `ctl.signal` aborts a running review (Stop). Facts already written stay; each
 *      file is written whole or not at all.
 *
 * A source that cannot review omits `review`; the view then offers no review control.
 */

import type { ReactNode } from 'react';
import type {
    Finding, KnowledgeGraph, ReviewPlan, ReviewProgress as MemoryReviewProgress, ReviewReport,
} from '@seanhogg/builderforce-memory/knowledge';

export type LensId =
    | 'structure' | 'partitions' | 'duplication' | 'claims' | 'links' | 'unused' | 'knowledge' | 'live' | 'compare';

export interface KnowledgeScopeSummary {
    rootId: string;
    title: string;
    packs: string[];
    lastReviewedAt?: string;
}

export interface KnowledgeSearchHit {
    ref: string;
    score: number;
    tier: string;
}

/** A place the host can review: its workspace, a folder upload, a connected drive… */
export interface ReviewTarget {
    id: string;
    kind: 'workspace' | 'upload' | 'drive' | 'folder';
    /** The host's own words for it (an account, a folder). The view supplies the kind's label. */
    title?: string;
}

export interface ReviewRequest {
    /** Re-review a known root. */
    rootId?: string;
    /** Review this target (from `targets()`). */
    target?: string;
    /** Let the host pick the directory (its default picker). */
    pick?: boolean;
    /** Ignore the manifest: plan every file as changed (*Re-review all*). */
    force?: boolean;
}

export interface ReviewEstimate {
    modelCalls: number;
    /** ≈ cost in USD, when the host can price the judgement pass. */
    costUsd?: number;
}

export type KnowledgeReviewEvent =
    | { type: 'plan'; plan: ReviewPlan; estimate?: ReviewEstimate }
    | { type: 'progress'; progress: MemoryReviewProgress }
    | { type: 'done'; rootId: string; report: ReviewReport }
    | { type: 'cancelled' };

export interface ReviewControl {
    /** Resolves when the person answers the confirm chip. `false` writes nothing. */
    confirm(plan: ReviewPlan, estimate?: ReviewEstimate): Promise<boolean>;
    signal: AbortSignal;
}

/** What a person may do to one stored fact. Absent when they may do nothing. */
export interface FactActions {
    /** Author or project admin only (PRD 38 §8.3); also removes the fact's relations. */
    delete?(): Promise<void>;
}

export interface KnowledgeGraphSource {
    scopes(): Promise<KnowledgeScopeSummary[]>;
    load(rootId: string, opts?: { focus?: string[]; maxNodes?: number }): Promise<KnowledgeGraph | null>;
    /** Where this host can review. Absent or empty ⇒ `review({ pick: true })` only. */
    targets?(): Promise<ReviewTarget[]>;
    /** plan → confirm → run. Call it synchronously inside the user gesture (see the header). */
    review?(req: ReviewRequest, ctl: ReviewControl): AsyncIterable<KnowledgeReviewEvent>;
    search?(rootId: string, q: string): Promise<KnowledgeSearchHit[]>;
    subscribeLive?(rootId: string, cb: (g: KnowledgeGraph) => void): () => void;
    rememberFact?(fact: { content: string; ref: string; rootId: string }): Promise<void>;
    /** The actions this viewer has on a fact node; `undefined` when they have none. */
    factActions?(ref: string): Promise<FactActions | undefined>;
    /** The graph a Compare lens reads as "before", when the host keeps one (web: the
     *  root's previous review, `GET …/knowledge-graph?at=<previousDigest>`). */
    baseline?(rootId: string): Promise<KnowledgeBaseline | null>;
    /**
     * A source that already HOLDS its graph (a tool result, an analysis report): the view
     * paints it on the first render and never loads. `scopes`/`load` still answer for it.
     */
    snapshot?: KnowledgeSnapshot;
    /** Where a finding was seen: line ranges and an excerpt, when the host knows them. */
    evidence?(finding: Finding, side: EvidenceSide): FindingEvidence[];
}

/** Compare's "before". */
export interface KnowledgeBaseline {
    graph: KnowledgeGraph;
    /**
     * `false` ⇒ before and after cannot be measured against each other (an analyzer failed
     * or changed on one side): Compare says so instead of reporting a missing finding as
     * resolved. Default true.
     */
    comparable?: boolean;
}

export interface KnowledgeSnapshot {
    graph: KnowledgeGraph;
    title?: string;
    baseline?: KnowledgeBaseline | null;
}

/** Which graph a finding came from: the current one, or Compare's "before". */
export type EvidenceSide = 'current' | 'baseline';

/** A line range in a source. `openable: false` ⇒ the host cannot open it (an old revision
 *  it no longer has); `href` is then the fallback link, when there is one. */
export interface SourceLocation {
    path: string;
    startLine: number;
    endLine: number;
    /** The revision the range belongs to, when it is not the working tree. */
    revision?: string;
    openable?: boolean;
    href?: string;
}

export interface FindingEvidence {
    /** The item's own name (a symbol, a dependency). */
    label?: string;
    locations: SourceLocation[];
    excerpt?: string;
}

/** The host's side panel (web: SlideOutPanel). Absent ⇒ the package's own sheet. */
export interface KnowledgePanelRenderProps {
    open: boolean;
    title: string;
    onClose(): void;
    children: ReactNode;
}

export type KnowledgePanelRenderer = (props: KnowledgePanelRenderProps) => ReactNode;

/** The host's destructive confirmation (web: `useConfirm`). Absent ⇒ an inline two-step. */
export type KnowledgeConfirm = (message: string) => Promise<boolean>;
