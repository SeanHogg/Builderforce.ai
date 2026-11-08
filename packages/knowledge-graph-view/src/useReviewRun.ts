/**
 * The review state machine — the view's half of the confirm handshake (see `types.ts`).
 *
 *   idle → planning → confirm(plan) ─Confirm→ running(progress…) → done(report)
 *                             ├─Cancel──→ cancelled (nothing written)
 *                             └─Re-review all→ a NEW review with `force: true`
 *   running ─Stop→ stopping ─the host settles→ aborted (what was written stays) | done | error
 *   stopping ─Force stop→ aborted at once (the stream is let go; the host's own record settles on its own)
 *   start(req, { autoConfirm }) answers the plan yes as it lands (Resume); the Reviews panel is where all of this is driven
 *
 * `start` calls `source.review` SYNCHRONOUSLY, so a host picker that needs the user's
 * gesture opens inside the click that started it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReviewPlan, ReviewProgress, ReviewReport } from '@seanhogg/builderforce-memory/knowledge';
import { failureDetailOf, type ReviewFailureDetail } from './reviewFailure';
import type { KnowledgeGraphSource, ReviewEstimate, ReviewRequest, SkippedFile } from './types';

export type ReviewState =
    | { status: 'idle' }
    /** `progress`: the walk's own count, when the host reports one before the plan. */
    | { status: 'planning'; progress?: ReviewProgress }
    /** `force`: this plan ignores the manifest (*Everything again*), so every file is planned as changed. */
    | { status: 'confirm'; plan: ReviewPlan; estimate?: ReviewEstimate; force?: boolean }
    | { status: 'running'; progress?: ReviewProgress }
    /** Stop was pressed (at `stoppedAt`, epoch ms); the host is still finishing the file in hand. The real terminal state lands when it settles. */
    | { status: 'stopping'; progress?: ReviewProgress; stoppedAt: number }
    | { status: 'done'; rootId: string; report: ReviewReport; skipped?: SkippedFile[] }
    | { status: 'cancelled' }
    | { status: 'aborted' }
    | ReviewErrorState;

/** A failed review: the reason, plus what a report of it needs (see `reviewDiagnostics.ts`). */
export interface ReviewErrorState extends ReviewFailureDetail {
    status: 'error';
    message: string;
    /** ISO time of the failure. */
    at: string;
    /** The root being reviewed, when the plan had named it. */
    rootId?: string;
    /** The phase last reported before the failure; absent when it failed before any progress. */
    lastPhase?: ReviewProgress['phase'];
}

export interface StartOptions {
    autoConfirm?: boolean;
}

export interface ReviewRun {
    state: ReviewState;
    available: boolean;
    /** `autoConfirm`: answer the plan *yes* as soon as it lands (Resume: the person already chose). */
    start(req: ReviewRequest, opts?: StartOptions): void;
    /** The confirm chip's answer. */
    answer(ok: boolean): void;
    /** Cancel this plan and plan again ignoring the manifest. */
    rereviewAll(): void;
    stop(): void;
    /** Lets go of a review the host will not confirm stopped: the view is `aborted` at once (what was written stays) and the stream is detached; the host's own record settles on its own. */
    forceStop(): void;
    dismiss(): void;
    /** The phase last reported by the run, for diagnostics. Ref-backed: reading it never re-renders. */
    readonly lastPhase?: ReviewProgress['phase'];
    /** The root the run is reviewing, once the plan or the request names it. Ref-backed like `lastPhase`. */
    readonly rootId?: string;
    /** The plan's judge budget (files), once a plan landed. Ref-backed like `lastPhase`. */
    readonly judgeFiles?: number;
}

export function useReviewRun(
    source: KnowledgeGraphSource,
    onDone: (rootId: string, report: ReviewReport) => void,
): ReviewRun {
    const [state, setState] = useState<ReviewState>({ status: 'idle' });
    const pending = useRef<((ok: boolean) => void) | null>(null);
    const running = useRef<AbortController | null>(null);
    const planRoot = useRef<string | undefined>(undefined);
    const lastPhase = useRef<ReviewProgress['phase'] | undefined>(undefined);
    const judgeFiles = useRef<number | undefined>(undefined);
    const lastReq = useRef<ReviewRequest>({});
    const onDoneRef = useRef(onDone);
    onDoneRef.current = onDone;

    const settle = (ok: boolean) => {
        const resolve = pending.current;
        pending.current = null;
        resolve?.(ok);
    };

    const start = useCallback((req: ReviewRequest, opts: StartOptions = {}) => {
        if (!source.review) return;
        settle(false);
        running.current?.abort();
        const ctl = new AbortController();
        running.current = ctl;
        lastReq.current = req;
        planRoot.current = undefined;
        lastPhase.current = undefined;
        setState({ status: 'planning' });
        const live = () => running.current === ctl;
        const force = req.force === true;
        // The plan state, carrying whether it ignores the manifest (so the panel keeps "Everything again" chosen).
        const confirming = (plan: ReviewPlan, estimate?: ReviewEstimate): ReviewState => ({
            status: 'confirm', plan, ...(estimate ? { estimate } : {}), ...(force ? { force } : {}),
        });
        let autoAnswered = false;
        const iterable = source.review(req, {
            signal: ctl.signal,
            confirm: (plan, estimate) => new Promise<boolean>((resolve) => {
                if (!live()) { resolve(false); return; }
                planRoot.current = plan.rootId;
                judgeFiles.current = plan.judgeFiles;
                if (opts.autoConfirm) {
                    // Resume: the person chose already; no confirm state is ever shown.
                    autoAnswered = true;
                    setState({ status: 'running' });
                    resolve(true);
                    return;
                }
                pending.current = resolve;
                setState(confirming(plan, estimate));
            }),
        });
        void (async () => {
            try {
                for await (const ev of iterable) {
                    if (!live()) return;
                    if (ev.type === 'plan') {
                        planRoot.current = ev.plan.rootId;
                        judgeFiles.current = ev.plan.judgeFiles;
                        if (!autoAnswered && !opts.autoConfirm) setState(confirming(ev.plan, ev.estimate));
                    } else if (ev.type === 'progress') {
                        lastPhase.current = ev.progress.phase;
                        setState((cur) => (cur.status === 'stopping' ? { ...cur, progress: ev.progress } : cur.status === 'planning' && ev.progress.phase === 'plan' ? { status: 'planning', progress: ev.progress } : { status: 'running', progress: ev.progress }));
                    } else if (ev.type === 'done') {
                        setState(ev.report.aborted ? { status: 'aborted' } : { status: 'done', rootId: ev.rootId, report: ev.report, ...(ev.skipped?.length ? { skipped: ev.skipped } : {}) });
                        onDoneRef.current(ev.rootId, ev.report);
                    } else {
                        setState({ status: 'cancelled' });
                    }
                }
                // The host closed the stream without a terminal event after Stop: the run is over.
                if (live() && ctl.signal.aborted) setState((cur) => (cur.status === 'stopping' ? { status: 'aborted' } : cur));
            } catch (err) {
                if (!live()) return;
                if (ctl.signal.aborted) { setState({ status: 'aborted' }); return; }
                const rootId = planRoot.current ?? req.rootId;
                setState({
                    status: 'error',
                    message: err instanceof Error ? err.message : String(err),
                    at: new Date().toISOString(),
                    ...(rootId ? { rootId } : {}),
                    ...(lastPhase.current ? { lastPhase: lastPhase.current } : {}),
                    ...failureDetailOf(err),
                });
            }
        })();
    }, [source]);

    const answer = useCallback((ok: boolean) => {
        if (ok) setState({ status: 'running' });
        settle(ok);
    }, []);

    const rereviewAll = useCallback(() => {
        const rootId = planRoot.current;
        start({ ...lastReq.current, ...(rootId ? { rootId } : {}), force: true });
    }, [start]);

    const stop = useCallback(() => {
        settle(false);
        running.current?.abort();
        // Not over yet: the host settles when the file in hand is done; the iterable lands the real state.
        setState((cur) => (cur.status === 'running' ? { status: 'stopping', stoppedAt: Date.now(), ...(cur.progress ? { progress: cur.progress } : {}) } : cur.status === 'stopping' ? cur : { status: 'aborted' }));
    }, []);

    const forceStop = useCallback(() => {
        settle(false);
        running.current?.abort();
        running.current = null; // detached: nothing the stream says after this moves the state
        setState({ status: 'aborted' });
    }, []);

    const dismiss = useCallback(() => {
        if (pending.current) return;
        setState({ status: 'idle' });
    }, []);

    useEffect(() => () => {
        settle(false);
        running.current?.abort();
        running.current = null;
    }, []);

    return { state, available: !!source.review, start, answer, rereviewAll, stop, forceStop, dismiss, get lastPhase() { return lastPhase.current; }, get rootId() { return planRoot.current ?? lastReq.current.rootId; }, get judgeFiles() { return judgeFiles.current; } };
}
