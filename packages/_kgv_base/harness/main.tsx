/**
 * The `/preview` harness: the ONE `KnowledgeGraphView` over the OrderService sample
 * (`orderFixture.ts`), full viewport. `npm run harness` builds it into one self-contained
 * HTML file; `npm run harness:dev` serves it.
 *
 * URL: `?band=code&method=<ref or method name>` opens focused on that method. The value is
 * only ever matched against the fixture's own refs; it is never written into the page.
 */

import { createRoot } from 'react-dom/client';
import { KnowledgeGraphView, setWorkerFactory } from '../src/index';
import '../src/tokens.css';
// The compute worker as a BLOB worker, as the VS Code webview registers it (`KnowledgeView.tsx`): a single-file page has no
// worker URL to load, and without the worker the view computes on the main thread.
import KnowledgeComputeWorker from '../src/compute/graphCompute.worker.ts?worker&inline';
import { orderGraph, orderSource } from './orderFixture';

setWorkerFactory(() => new KnowledgeComputeWorker() as never);

/** The fixture ref `?band=code&method=…` names (its exact ref, or a method's name), else nothing. */
function focusFromUrl(search: string): string[] | undefined {
    const q = new URLSearchParams(search);
    const method = q.get('method');
    if (q.get('band') !== 'code' || !method) return undefined;
    const hit = orderGraph().nodes.find((n) => n.ref === method || ((n.kind === 'method' || n.kind === 'function') && n.label === method));
    return hit ? [hit.ref] : undefined;
}

const mount = document.getElementById('root');
if (!mount) throw new Error('harness: index.html has no #root');

const initialFocus = focusFromUrl(window.location.search);

createRoot(mount).render(
    <div style={{ position: 'fixed', inset: 0 }}>
        <KnowledgeGraphView
            source={orderSource()}
            onOpenSource={(location) => console.info('openSource', location)}
            {...(initialFocus ? { initialFocus } : {})}
        />
    </div>,
);
