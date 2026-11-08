import type { Layout2D } from '../../graph2d/layout2d';
import type { Layout3D } from '../../scene/layout3d';
import { unpackPlaced } from '../placed';
import type { Codec } from './codec';

export const layout2d: Codec<'layout2d'> = {
    encode: ({ rootId, nodes, edges }, residency) => {
        const refs = residency.locate({ nodes, edges });
        return { graph: refs.graph, req: { refs, rootId } };
    },
    decode: (raw, { nodes }) => ({ positions: unpackPlaced(nodes, raw.placed) as unknown as Layout2D['positions'], bands: raw.bands, bounds: raw.bounds }),
};

export const layout3d: Codec<'layout3d'> = {
    encode: ({ rootId, nodes, edges }, residency) => {
        const refs = residency.locate({ nodes, edges });
        return { graph: refs.graph, req: { refs, rootId } };
    },
    decode: (raw, { nodes }) => ({ positions: unpackPlaced(nodes, raw.placed) as unknown as Layout3D['positions'], planes: raw.planes }),
};
