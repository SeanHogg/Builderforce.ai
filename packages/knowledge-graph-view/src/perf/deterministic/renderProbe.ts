/**
 * The whole `KnowledgeGraphView`, mounted once on a graph whose arrays and elements COUNT every read (`mainMeter.wrapGraph`),
 * with the compute worker replaced by the {@link LoopbackWorker}, then driven through every view the camera bar offers. Per view
 * it records what the MAIN thread still did: graph reads while rendering (`mount`) and while the worker's answers landed
 * (`settle`), React commits, DOM size, and where each compute task ran. Reads and counts, never time, so the record is the same
 * on every run.
 *
 * The test file mocks `scene/GraphScene` (jsdom has no WebGL) exactly as `KnowledgeGraphView.views.test.tsx` does, and hands in
 * the {@link ViewHost}: testing-library and vitest are dev-only, and this package's source-package guard forbids a non-test file
 * from importing them, so everything that needs them (rendering, `act`, clicks, the stubs that make jsdom look like a browser
 * with WebGL, reduced motion and a 1280x720 box) lives behind that one interface. A view the bar does not offer for this graph
 * is listed in `skipped`, never silently dropped.
 *
 * "Settled" means the loopback has nothing to deliver AND the page stopped changing (reads, commits, DOM, compute events) for
 * three rounds in a row; every round runs inside `act` so the answers' state updates are flushed and the effects they trigger
 * (the next task of a chain) get their turn.
 */

import { createElement, Profiler, type ReactElement } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { getComputeClient, setComputeProbe, setWorkerFactory } from '../../compute/sharedClient';
import { weightOf } from '../../compute/size';
import { KnowledgeGraphView } from '../../KnowledgeGraphView';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { fixtureSource } from '../../testing';
import { LoopbackWorker, type TaskRun } from './loopbackWorker';
import { WorkMeter } from './meter';
import { ProbeLog } from './probeLog';
import type { WireEntry, WireSummary } from './wireLedger';

/** What the probe needs from the test runner (see the file comment). */
export interface ViewHost {
    /** Mounts `element` (synchronously, inside `act`) and returns its container. */
    render(element: ReactElement): HTMLElement;
    act(work: () => Promise<void>): Promise<void>;
    click(element: Element): void;
    /** Unmounts everything. */
    cleanup(): void;
    /** Makes jsdom claim WebGL, reduced motion and a 1280x720 box; returns the function that undoes it. */
    environment(): () => void;
}

export interface ViewRecord {
    /** `boot` is the first mount (the graph load and the default view); the rest are camera ids. */
    id: string;
    /** Graph reads while the click / mount rendered synchronously. */
    mountReads: number;
    /** Graph reads while the worker's answers were delivered and rendered. */
    settleReads: number;
    commits: number;
    dom: number;
    mainTasks: number;
    workerTasks: number;
}

export interface RenderReport {
    views: ViewRecord[];
    /** Views the camera bar did not offer for this graph. */
    skipped: string[];
    wire: WireSummary;
    wireEntries: readonly WireEntry[];
    tasks: readonly TaskRun[];
    probe: ProbeLog;
}

/** The order the views are visited in (fixed: a view's cost depends on what the views before it left memoised). */
export const VIEW_ORDER = ['system', 'graph', 'map', 'tower', '3d', 'heat', 'list', 'transit'] as const;
const MAX_ROUNDS = 400;

export async function probeViews(graph: KnowledgeGraph, host: ViewHost): Promise<RenderReport> {
    const main = new WorkMeter('main');
    const loop = new LoopbackWorker({ main, worker: new WorkMeter('worker') });
    // Weighed at the moment of the event, while the shared client (the one emitting it) still holds the graph.
    const probe = new ProbeLog((id) => { const held = getComputeClient().residency.handleOf(id)?.graph; return held ? weightOf(held) : undefined; });
    let commits = 0;
    const restore = host.environment();
    setWorkerFactory(() => loop);
    setComputeProbe(probe);
    try {
        const source = fixtureSource([main.wrapGraph(graph)], { review: false });
        const tree = createElement(Profiler, { id: 'kg', onRender: () => { commits++; } }, createElement(KnowledgeGraphView, { source }));
        const views: ViewRecord[] = [];
        const skipped: string[] = [];
        let container!: HTMLElement;
        const dom = (): number => container.querySelectorAll('*').length;
        const fingerprint = (): string => `${main.reads}|${commits}|${dom()}|${probe.events.length}|${loop.ledger.entries.length}`;

        async function settled(): Promise<void> {
            let calm = 0, last = fingerprint();
            for (let round = 0; calm < 3; round++) {
                if (round > MAX_ROUNDS) throw new Error('render probe: the page did not settle');
                let delivered = 0;
                await host.act(async () => { delivered = await loop.settle(); });
                const now = fingerprint();
                calm = delivered === 0 && now === last ? calm + 1 : 0;
                last = now;
            }
        }

        /** Records what `action` (a click, or the first mount) costs on the main thread, then waits for the page to settle. */
        async function visit(id: string, action: () => void): Promise<void> {
            const reads = main.mark(), seen = commits, events = probe.mark();
            action();
            const mountReads = main.since(reads);
            const afterMount = main.mark();
            await settled();
            const ran = probe.since(events);
            views.push({
                id, mountReads, settleReads: main.since(afterMount), commits: commits - seen, dom: dom(),
                mainTasks: ran.filter((e) => e.realm !== 'worker').length, workerTasks: ran.filter((e) => e.realm === 'worker').length,
            });
        }

        // The camera bar's View group only: other segmented controls (the panel dock, drawers) carry `data-seg` too.
        const bar = (): Element | null => container.querySelector(`[role="radiogroup"][aria-label="${L.viewModesLabel}"]`);
        const seg = (id: string): HTMLButtonElement | null => bar()?.querySelector<HTMLButtonElement>(`[data-seg="${id}"]`) ?? null;
        const current = (): string | null | undefined => bar()?.querySelector('[data-seg][aria-checked="true"]')?.getAttribute('data-seg');
        const button = (text: string): HTMLButtonElement | undefined => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text && !b.disabled);

        await visit('boot', () => { container = host.render(tree); });
        const first = current();
        for (const id of VIEW_ORDER) {
            const target = seg(id);
            if (id === first) continue; // the boot record is this view's
            if (!target || target.disabled) { skipped.push(id); continue; }
            await visit(id, () => { host.click(target); });
        }
        // Sequence has no button in the bar: the path strip's toggle opens it, its "enlarge" switches the view to it. The strip is
        // the transit map's, so go back there first (unrecorded) when the loop ended elsewhere (the boot view was transit).
        const transit = seg('transit');
        if (current() !== 'transit' && transit && !transit.disabled) {
            host.click(transit);
            await settled();
        }
        if (button(L.surface.path.sequence)) {
            await visit('sequence', () => {
                host.click(button(L.surface.path.sequence)!);
                const enlarge = button(L.surface.path.enlarge);
                if (enlarge) host.click(enlarge);
            });
            if (!container.querySelector('[data-testid="kg-sequence"]')) skipped.push('sequence');
        } else {
            skipped.push('sequence');
        }
        // Copies: the unmount below still posts (cancels) into the live ledger, and the report is what the views did.
        return { views, skipped, wire: loop.ledger.summary(), wireEntries: [...loop.ledger.entries], tasks: [...loop.tasks], probe };
    } finally {
        // The probe goes first: replacing the shared client settles what it still owed IN-PROCESS, which is teardown, not the view.
        setComputeProbe(null);
        host.cleanup();
        setWorkerFactory(null);
        loop.terminate();
        restore();
    }
}
