/**
 * The review state machine — the view's half of the confirm handshake (see `types.ts`).
 *
 *   idle → planning → confirm(plan) ─Confirm→ running(progress…) → done(report)
 *                             ├─Cancel──→ cancelled (nothing written)
 *                             └─Re-review all→ a NEW review with `force: true`
 *   running ─Stop→ aborted (what was written stays)
 *
 * `start` calls `source.review` SYNCHRONOUSLY, so a host picker that needs the user's
 * gesture opens inside the click that started it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReviewPlan, ReviewProgress, ReviewReport } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphSource, ReviewEstimate, ReviewRequest } from './types';

export type ReviewState =
    | { status: 'idle' }
    | { status: 'planning' }
    | { status: 'confirm'; plan: ReviewPlan; estimate?: ReviewEstimate }
    | { status: 'running'; progress?: ReviewProgress }
    | { status: 'done'; rootId: string; report: ReviewReport }
    | { status: 'cancelled' }
    | { status: 'aborted' }
    | { status: 'error'; message: string };

export interface ReviewRun {
    state: ReviewState;
    available: boolean;
    start(req: ReviewRequest): void;
    /** The confirm chip's answer. */
    answer(ok: boolean): void;
    /** Cancel this plan and plan again ignoring the manifest. */
    rereviewAll(): void;
    stop(): void;
    dismiss(): void;
}

export function useReviewRun(
    source: KnowledgeGraphSource,
    onDone: (rootId: string, report: ReviewReport) => void,
): ReviewRun {
    const [state, setState] = useState<ReviewState>({ status: 'idle' });
    const pending = useRef<((ok: boolean) => void) | null>(null);
    const running = useRef<AbortController | null>(null);
    const planRoot = useRef<string | undefined>(undefined);
    const lastReq = useRef<ReviewRequest>({});
    const onDoneRef = useRef(onDone);
    onDoneRef.current = onDone;

    const settle = (ok: boolean) => {
        const resolve = pending.current;
        pending.current = null;
        resolve?.(ok);
    };

    const start = useCallback((req: ReviewRequest) => {
        if (!source.review) return;
        settle(false);
        running.current?.abort();
        const ctl = new AbortController();
        running.current = ctl;
        lastReq.current = req;
        setState({ status: 'planning' });
        const live = () => running.current === ctl;
        const iterable = source.review(req, {
            signal: ctl.signal,
            confirm: (plan, estimate) => new Promise<boolean>((resolve) => {
                if (!live()) { resolve(false); return; }
                pending.current = resolve;
                planRoot.current = plan.rootId;
                setState(estimate ? { status: 'confirm', plan, estimate } : { status: 'confirm', plan });
            }),
        });
        void (async () => {
            try {
                for await (const ev of iterable) {
                    if (!live()) return;
                    if (ev.type === 'plan') {
                        planRoot.current = ev.plan.rootId;
                        setState(ev.estimate ? { status: 'confirm', plan: ev.plan, estimate: ev.estimate } : { status: 'confirm', plan: ev.plan });
                    } else if (ev.type === 'progress') {
                        setState({ status: 'running', progress: ev.progress });
                    } else if (ev.type === 'done') {
                        setState(ev.report.aborted ? { status: 'aborted' } : { status: 'done', rootId: ev.rootId, report: ev.report });
                        onDoneRef.current(ev.rootId, ev.report);
                    } else {
                        setState({ status: 'cancelled' });
                    }
                }
            } catch (err) {
                if (!live()) return;
                setState(ctl.signal.aborted ? { status: 'aborted' } : { status: 'error', message: err instanceof Error ? err.message : String(err) });
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

    return { state, available: !!source.review, start, answer, rereviewAll, stop, dismiss };
}
