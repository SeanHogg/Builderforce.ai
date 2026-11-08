/**
 * knowledge/landingManifest.ts — a manifest that holds back entries describing stored facts until the facts have landed.
 *
 * The analyzers' output is stored by the review AFTER `analyse` returns, so the "which analysis outputs did the last run
 * produce" entry must not be written when `analyse` returns: a manifest ahead of its facts is lost knowledge (and, on the
 * SQLite store, a manifest-only commit that runs ahead). The review writes its own manifest entries only after it has stored
 * and flushed everything the run produced, so the held entries are committed immediately BEFORE the first write the review
 * makes (they land with or after their facts, never ahead). An aborted run never reaches that write and drops them.
 */

import type { ChunkFingerprint, IngestManifest } from '@seanhogg/builderforce-memory/ingest';

export interface LandingManifest extends IngestManifest {
    /** Holds an entry until the review's next manifest write. */
    hold(sourceId: string, fingerprints: ChunkFingerprint[]): void;
}

export function landingManifest(inner: IngestManifest): LandingManifest {
    const held = new Map<string, ChunkFingerprint[]>();
    const land = async (): Promise<void> => {
        for (const [id, fps] of [...held]) {
            await inner.set(id, fps);
            held.delete(id);
        }
    };
    return {
        hold: (id, fps) => { held.set(id, fps); },
        get: async (id) => held.get(id) ?? inner.get(id),
        async set(id, fps) {
            await land();
            held.delete(id);
            await inner.set(id, fps);
        },
        async delete(id) {
            held.delete(id);
            await inner.delete(id);
        },
    };
}

export const isLandingManifest = (m: IngestManifest): m is LandingManifest => typeof (m as Partial<LandingManifest>).hold === 'function';
