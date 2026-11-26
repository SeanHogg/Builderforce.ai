/**
 * The deploy and concurrency facts the code pack writes onto the graph (agent-tools `knowledge/deploy/` and
 * `codeConcurrency.ts`), read by name — the view never imports a host package, so the names are restated here as data:
 *
 *   a deployable unit  = an `entity` node whose `type` badge is `deployable-unit` (`unitKind`, `runtime`, `ports`,
 *                        `source`, `bindings`, `cron`, `externals` badges);
 *   a binding          = an `entity` node whose `type` badge is `deploy-binding` (`bindingKind`);
 *   concurrency        = a file's `concurrency` badge (`durable-object:ChatRoom,poller`).
 *
 * The 4+1 coverage map (`fourPlusOne.ts`) probes the Physical and Process aspects through these. Pure.
 */

import type { KnowledgeGraph, KNode } from '@seanhogg/builderforce-memory/knowledge';

export const DEPLOY_UNIT_TYPE = 'deployable-unit';
export const DEPLOY_BINDING_TYPE = 'deploy-binding';
export const CONCURRENCY_BADGE = 'concurrency';

export interface DeployUnitFact {
    ref: string;
    name: string;
    /** container · worker · function · service · cli · workflow */
    kind: string;
    runtime: string;
    ports: number[];
    /** Root-relative folders / files it ships. */
    sources: string[];
}

const badge = (n: KNode, key: string): string => String(n.badges?.[key] ?? '');
const list = (v: string): string[] => v.split(',').map((s) => s.trim()).filter(Boolean);
const typed = (n: KNode, type: string): boolean => n.kind === 'entity' && n.badges?.['type'] === type;

export function deployUnitsOf(graph: Pick<KnowledgeGraph, 'nodes'>): DeployUnitFact[] {
    return graph.nodes.filter((n) => typed(n, DEPLOY_UNIT_TYPE)).map((n) => ({
        ref: n.ref, name: n.label, kind: badge(n, 'unitKind'), runtime: badge(n, 'runtime'),
        ports: list(badge(n, 'ports')).map(Number).filter(Number.isFinite), sources: list(badge(n, 'source')),
    }));
}

export function deployBindingsOf(graph: Pick<KnowledgeGraph, 'nodes'>): KNode[] {
    return graph.nodes.filter((n) => typed(n, DEPLOY_BINDING_TYPE));
}

/** Per file that starts concurrency, its entries (`kind` or `kind:Owner`). */
export function concurrencyOf(graph: Pick<KnowledgeGraph, 'nodes'>): Array<{ ref: string; entries: string[] }> {
    return graph.nodes.flatMap((n) => {
        const entries = list(badge(n, CONCURRENCY_BADGE));
        return n.kind === 'file' && entries.length > 0 ? [{ ref: n.ref, entries }] : [];
    });
}
