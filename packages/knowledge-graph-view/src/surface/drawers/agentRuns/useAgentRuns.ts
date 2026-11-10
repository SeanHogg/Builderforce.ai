/**
 * The Agent runs drawer's data: the host's run list, read ONCE when the drawer opens (and again on Retry), and the
 * selected run's report, read on select. A report that answers after another run was selected (or the drawer closed)
 * is dropped.
 *
 * The list read always SETTLES: a host that never answers (a dropped response, a store read that outlives the panel)
 * turns into the failed state with Retry after {@link AGENT_RUNS_TIMEOUT_MS}, and an answer that is not a list (a host
 * that predates the op) reads as "no runs" — the drawer never sits on "Reading…" for good.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentRunReport, AgentRunSummary, AgentRunsPort } from '../../../types';

/** How long the list may take before the drawer says it could not be read (and offers Retry). */
export const AGENT_RUNS_TIMEOUT_MS = 30_000;

export type AgentRunList = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; runs: readonly AgentRunSummary[] };
export type AgentRunDetail = { state: 'idle' } | { state: 'loading' } | { state: 'missing' } | { state: 'ready'; report: AgentRunReport };

export interface AgentRunsState {
    list: AgentRunList;
    selected: string | null;
    detail: AgentRunDetail;
    select(id: string): void;
    /** Reads the list again (the failed state's Retry). */
    retry(): void;
}

/** @param rootId the graph's root, so the host can say where it sits on disk (`AgentRunReport.root`). */
export function useAgentRuns(port: AgentRunsPort | undefined, rootId?: string): AgentRunsState {
    // No port ⇒ nothing recorded (the registry hides the drawer then, but a forced render must not spin forever).
    const [list, setList] = useState<AgentRunList>(port ? { state: 'loading' } : { state: 'ready', runs: [] });
    const [selected, setSelected] = useState<string | null>(null);
    const [detail, setDetail] = useState<AgentRunDetail>({ state: 'idle' });
    /** Bumped by Retry: the list effect reads again. */
    const [attempt, setAttempt] = useState(0);
    /** The select whose answer is still wanted; a newer select (or unmount) moves it on. */
    const ticket = useRef(0);

    useEffect(() => {
        if (!port) return undefined;
        let alive = true;
        setList({ state: 'loading' });
        const timer = setTimeout(() => { if (alive) { alive = false; setList({ state: 'failed' }); } }, AGENT_RUNS_TIMEOUT_MS);
        const settle = (next: AgentRunList): void => {
            if (!alive) return;
            alive = false;
            clearTimeout(timer);
            setList(next);
        };
        let read: Promise<readonly AgentRunSummary[]>;
        try { read = port.list(); } catch (error) { read = Promise.reject(error); }
        read.then(
            (runs) => settle({ state: 'ready', runs: Array.isArray(runs) ? runs : [] }),
            () => settle({ state: 'failed' }),
        );
        return () => { alive = false; clearTimeout(timer); ticket.current++; };
    }, [port, attempt]);

    const select = useCallback((id: string) => {
        if (!port) return;
        const mine = ++ticket.current;
        setSelected(id);
        setDetail({ state: 'loading' });
        port.report(id, rootId).then(
            (report) => { if (ticket.current === mine) setDetail(report ? { state: 'ready', report } : { state: 'missing' }); },
            () => { if (ticket.current === mine) setDetail({ state: 'missing' }); },
        );
    }, [port, rootId]);

    const retry = useCallback(() => setAttempt((n) => n + 1), []);

    return { list, selected, detail, select, retry };
}
