/**
 * The stage's three worker tasks (PRD 43 B1a): `markSet` (once per graph), `markPaint` (lens / question / overlay as data)
 * and `placement` (one camera's layout of the same marks). Selection is in none of them. Every reply is typed arrays the
 * worker hands over (`transfer.ts`); the pinned model keeps its own copies.
 */

import type { ModelInputs } from '../protocol';
import { once, type Handler } from './handler';
import { paintMarks } from './markPaint';
import { PLACEMENTS } from './placement';
import { placeDrill } from './placement/drill';
import { buildSlotIncident } from './stageIncident';
import { copyMarkSet, stageModelOf } from './stageModel';

export const markSet: Handler<'markSet'> = (store, { graph, changed, strings }) => once(() => copyMarkSet(stageModelOf(store, graph, changed, strings).marks));

/** The model a request names: its own inputs when it carries them (any realm builds the same model), else the held one. */
const modelOf = (store: Parameters<Handler<'placement'>>[0], graph: number, model?: ModelInputs) => stageModelOf(store, graph, model?.changed, model?.strings);

export const markPaint: Handler<'markPaint'> = (store, { graph, lensId, questionId, overlay, lit, roles, family, model }) => once(() =>
    paintMarks(store.graph(graph), modelOf(store, graph, model), { lensId, questionId, overlay, lit, roles, family }));

export const placement: Handler<'placement'> = (store, req) => {
    // A drilled level is its own placement of the same marks (B7: drill enter / exit), whatever the camera.
    if (req.drill) return once(() => placeDrill(store.graph(req.graph), modelOf(store, req.graph, req.model), req));
    const builder = PLACEMENTS[req.camera];
    if (!builder) return once(() => { throw new Error(`stage: no placement for camera ${String(req.camera)}`); });
    return builder(store.graph(req.graph), modelOf(store, req.graph, req.model), req);
};

/** The ranked incident index by slot (B5), once per graph. */
export const stageIncident: Handler<'stageIncident'> = (store, { graph, model }) => once(() => buildSlotIncident(store.graph(graph), modelOf(store, graph, model)));
