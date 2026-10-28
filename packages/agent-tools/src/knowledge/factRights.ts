/**
 * knowledge/factRights.ts — who may delete a fact (PRD 38 §8.3), the client half of the
 * rule the delete route enforces: a viewer who administers the project, the fact's
 * author, or anyone when the fact has no author. ONE copy for every host that shows the
 * graph (the browser source — web and Rovr — and VS Code's bridge).
 *
 * The answer comes from the facts endpoint (`GET …/knowledge/facts?root=`): the root's
 * facts with `createdBy`, and the `viewer` as the server decides it. A host reads that
 * listing ONCE per graph version ({@link factRightsCache}) — never per node click.
 */

/** Who is looking, as the server decides it (`KnowledgeFacts.viewer`). */
export interface FactViewer {
    userId: string | null;
    canAdmin: boolean;
}

/** A fact as the rights rule reads it. */
export interface FactAuthor {
    key: string;
    createdBy?: string | number | null;
}

/** The facts endpoint's answer, as the rule needs it. */
export interface FactsListing {
    facts: ReadonlyArray<FactAuthor>;
    viewer: FactViewer;
}

/** Delete is offered for `fact` (undefined = not a fact of this root ⇒ admins only). */
export function canDeleteFact(viewer: FactViewer, fact: Pick<FactAuthor, 'createdBy'> | undefined): boolean {
    if (viewer.canAdmin) return true;
    if (!fact) return false;
    if (fact.createdBy === null || fact.createdBy === undefined) return true;
    return viewer.userId !== null && String(fact.createdBy) === viewer.userId;
}

export interface FactRightsCache {
    /** The view loaded `rootId` at `version` (its graph digest): a moved version re-reads on the next ask. */
    loaded(rootId: string, version: string | undefined): void;
    /** Whether Delete is offered on fact `key` of `rootId` — one listing read per version. */
    canDelete(rootId: string, key: string): Promise<boolean>;
    /** The root's facts changed here (a note added, a fact deleted): re-read on the next ask. */
    invalidate(rootId: string): void;
}

interface Entry {
    version: string | undefined;
    rights: Promise<{ viewer: FactViewer; authors: Map<string, FactAuthor> } | null>;
}

/**
 * Per-root facts listings, cached by graph version. `load` is the host's facts read
 * (`client.facts(rootId)`); null (an unknown root) offers Delete to no one. A failed read
 * is not cached — the next ask tries again — and rejects to the caller, which reports it.
 */
export function factRightsCache(load: (rootId: string) => Promise<FactsListing | null>): FactRightsCache {
    const entries = new Map<string, Entry>();
    const versions = new Map<string, string | undefined>();

    const entryOf = (rootId: string): Entry => {
        const version = versions.get(rootId);
        const hit = entries.get(rootId);
        if (hit && hit.version === version) return hit;
        const entry: Entry = {
            version,
            rights: load(rootId).then((listing) => listing
                ? { viewer: listing.viewer, authors: new Map(listing.facts.map((f) => [f.key, f] as const)) }
                : null),
        };
        entry.rights.catch(() => { if (entries.get(rootId) === entry) entries.delete(rootId); });
        entries.set(rootId, entry);
        return entry;
    };

    return {
        loaded(rootId, version) {
            versions.set(rootId, version);
        },
        async canDelete(rootId, key) {
            const rights = await entryOf(rootId).rights;
            return !!rights && canDeleteFact(rights.viewer, rights.authors.get(key));
        },
        invalidate(rootId) {
            entries.delete(rootId);
        },
    };
}
