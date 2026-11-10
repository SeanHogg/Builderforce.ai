/**
 * The Agent runs drawer's data: the host's run list, read ONCE when the drawer opens, and the selected run's report,
 * read on select. A report that answers after another run was selected (or the drawer closed) is dropped.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentRunReport, AgentRunSummary, AgentRunsPort } from '../../../types';

export type AgentRunList = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; runs: readonly AgentRunSummary[] };
export type AgentRunDetail = { state: 'idle' } | { state: 'loading' } | { state: 'missing' } | { state: 'ready'; report: AgentRunReport };

export interface AgentRunsState {
    list: AgentRunList;
    selected: string | null;
    detail: AgentRunDetail;
    select(id: string): void;
}

export function useAgentRuns(port: AgentRunsPort | undefined): AgentRunsState {
    // No port ⇒ nothing recorded (the registry hides the drawer then, but a forced render must not spin forever).
    const [list, setList] = useState<AgentRunList>(port ? { state: 'loading' } : { state: 'ready', runs: [] });
    const [selected, setSelected] = useState<string | null>(null);
    const [detail, setDetail] = useState<AgentRunDetail>({ state: 'idle' });
    /** The select whose answer is still wanted; a newer select (or unmount) moves it on. */
    const ticket = useRef(0);

    useEffect(() => {
        if (!port) return undefined;
        let alive = true;
        port.list().then(
            (runs) => { if (alive) setList({ state: 'ready', runs }); },
            () => { if (alive) setList({ state: 'failed' }); },
        );
        return () => { alive = false; ticket.current++; };
    }, [port]);

    const select = useCallback((id: string) => {
        if (!port) return;
        const mine = ++ticket.current;
        setSelected(id);
        setDetail({ state: 'loading' });
        port.report(id).then(
            (report) => { if (ticket.current === mine) setDetail(report ? { state: 'ready', report } : { state: 'missing' }); },
            () => { if (ticket.current === mine) setDetail({ state: 'missing' }); },
        );
    }, [port]);

    return { list, selected, detail, select };
}
