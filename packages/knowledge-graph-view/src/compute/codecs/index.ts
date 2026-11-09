/** Every kind's codec, by kind: with `tasks/` (the other half) this table is the whole list of what can be computed off the main thread. */

import type { TaskKind } from '../protocol';
import type { Codec } from './codec';
import { edgeBuffers, edgePaths, rankEdges } from './edges';
import { antiPatterns, focus, insights, mindMap, partitionMatrix, path, surface, transitLayout } from './graph';
import { layout2d, layout3d } from './layout';

export const CODECS: { [K in TaskKind]: Codec<K> } = {
    layout2d, layout3d, rankEdges, edgePaths, edgeBuffers, mindMap, surface, transitLayout, path, insights, partitionMatrix, antiPatterns, focus,
};
