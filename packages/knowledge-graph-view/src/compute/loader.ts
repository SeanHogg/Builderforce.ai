/** Posts a resident graph to the worker, once, in slices (a few milliseconds of cloning each, so no frame is lost to one). */

import type { LoadField, WorkerIn } from './protocol';
import type { GraphHandle } from './residency';

/** Objects per slice: structured-cloning one costs ~20-30 µs, so 1,000 keeps each clone near 25 ms (the perf harness measures it). */
export const UPLOAD_SLICE = 1000;
/** Links per slice: four numbers each, sent as a transferred typed array, so a slice costs next to nothing. */
export const LINK_SLICE = 8000;

const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Sends one message; false when the load is no longer wanted (the graph was evicted, the worker replaced). May throw (a DataCloneError). */
export type Post = (message: WorkerIn, transfer?: Transferable[]) => boolean;

/** Rejects when a post throws; resolves early (without `load-end`) when `post` says the load is moot. */
export async function streamGraph(handle: GraphHandle, post: Post): Promise<void> {
    const { id } = handle;
    const { nodes, edges, findings, outline, ...shell } = handle.graph;
    const { files, links, ...outlineShell } = outline ?? { files: [], links: [] as Array<[number, number, number, number]> };
    if (!post({ type: 'load-begin', graph: id, shell, outline: outline ? outlineShell : null })) return;
    const fields: Array<[LoadField, readonly unknown[]]> = [['nodes', nodes], ['edges', edges], ['findings', findings], ['outlineFiles', files]];
    for (const [field, list] of fields) {
        for (let at = 0; at < list.length; at += UPLOAD_SLICE) {
            if (!post({ type: 'load-chunk', graph: id, field, items: list.slice(at, at + UPLOAD_SLICE) })) return;
            await macrotask();
        }
    }
    // Links are numbers: four per link in a typed array, which crosses by transfer.
    for (let at = 0; at < links.length; at += LINK_SLICE) {
        const flat = new Uint32Array(Math.min(LINK_SLICE, links.length - at) * 4);
        for (let i = 0; i < flat.length / 4; i++) flat.set(links[at + i]!, i * 4);
        if (!post({ type: 'load-chunk', graph: id, field: 'outlineLinks', items: flat }, [flat.buffer])) return;
        await macrotask();
    }
    post({ type: 'load-end', graph: id });
}
