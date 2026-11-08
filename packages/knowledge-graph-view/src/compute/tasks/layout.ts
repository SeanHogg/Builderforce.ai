/** The 2D and 3D layouts as tasks. Both are the existing pure steppers; this only packs their answer for the wire. */

import { layout2dTask } from '../../graph2d/layout2d';
import { layoutTask } from '../../scene/layout3d';
import { packPlaced } from '../placed';
import type { Handler } from './handler';

export const layout2d: Handler<'layout2d'> = (store, { refs, rootId }) => {
    const { nodes, edges } = store.subset(refs);
    const task = layout2dTask(rootId, nodes, edges);
    return {
        step: () => task.step(),
        result: () => { const l = task.result(); return { placed: packPlaced(nodes, l.positions, 2), bands: l.bands, bounds: l.bounds }; },
    };
};

export const layout3d: Handler<'layout3d'> = (store, { refs, rootId }) => {
    const { nodes, edges } = store.subset(refs);
    const task = layoutTask(rootId, nodes, edges);
    return {
        step: () => task.step(),
        result: () => { const l = task.result(); return { placed: packPlaced(nodes, l.positions, 3), planes: l.planes }; },
    };
};
