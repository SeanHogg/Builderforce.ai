/** Every task handler, by kind. The worker and the in-process fallback both read this table: ONE implementation of each task. */

import { mindMap } from '../../map/mindMapModel';
import type { TaskKind } from '../protocol';
import { edgeBufferTask, edgePaths, rankEdgesTask } from './edges';
import { once, type Handler } from './handler';
import { layout2d, layout3d } from './layout';
import { antiPatterns, focus, insights, matrix } from './reads';
import { path, surface } from './surface';

export const HANDLERS: { [K in TaskKind]: Handler<K> } = {
    layout2d,
    layout3d,
    rankEdges: rankEdgesTask,
    edgePaths,
    edgeBuffers: edgeBufferTask,
    mindMap: (store, { refs, opts }) => once(() => { const { nodes, findings } = store.subset(refs); return mindMap(nodes, findings, opts); }),
    surface,
    path,
    insights,
    partitionMatrix: matrix,
    antiPatterns,
    focus,
};
