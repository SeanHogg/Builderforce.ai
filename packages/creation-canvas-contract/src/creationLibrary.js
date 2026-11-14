/**
 * THE CREATION LIBRARY'S RULES — what a list of "everything you have made" is, and
 * how it is ordered, deduped and faceted.
 *
 * ── WHY THIS IS SHARED ───────────────────────────────────────────────────────
 * Three surfaces draw this list: the web's `/create` library, the VS Code sidebar's
 * Sessions tree, and (through the tree) the panel those rows open. All three were
 * making the same mistake independently — presenting a canvas and a Brain chat as
 * different KINDS OF PLACE, in separate sections, when both open the same board.
 *
 * The reason they are the same thing is a fact about the API, not about any one UI:
 * a chat, a workflow, a build, a project and an agent each have a `…/open` endpoint
 * that MATERIALISES a creation session and returns it. Whether the session row exists
 * yet is an implementation detail of the record, not a property of the destination.
 *
 * So the rules live here, once, and each surface supplies only its own vocabulary:
 * the web knows about localized subtitles and glyphs, the tree knows about
 * `ThemeIcon`s and commands, and neither re-derives what order the list is in or
 * whether a row is a duplicate of a card already on a board.
 *
 * ── WHAT IS DELIBERATELY *NOT* HERE ──────────────────────────────────────────
 * Anything that needs a catalog, a component or a `vscode` import. This module is
 * pure data and pure functions over a MINIMAL structural entry, so a surface adds
 * its own fields by extending {@link CreationLibraryEntry} rather than by widening
 * this contract.
 */
import { formatResourceRef } from './resourceRef';
/** Facet order wherever they are listed. Canvas first: it has the most rows. */
export const CREATION_LIBRARY_FACETS = [
    'canvas', 'build', 'workflow', 'chat', 'project', 'agent',
];
export function isCreationLibraryFacet(value) {
    return typeof value === 'string' && CREATION_LIBRARY_FACETS.includes(value);
}
/**
 * Pinned first, then most recently touched, then by title.
 *
 * The last clause is what keeps the order STABLE: many records report no timestamp
 * at all, and without it their relative order would depend on which fetch settled
 * first — a list that reshuffles between two identical renders.
 */
export function compareCreationLibraryEntries(a, b) {
    if (a.pinned !== b.pinned)
        return a.pinned ? -1 : 1;
    const at = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0;
    const bt = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0;
    const aValid = Number.isFinite(at) ? at : 0;
    const bValid = Number.isFinite(bt) ? bt : 0;
    if (aValid !== bValid)
        return bValid - aValid;
    return a.title.localeCompare(b.title);
}
/**
 * The library, in display order.
 *
 * Recency ACROSS sources is the whole point, and it is what a sectioned layout can
 * never express: a build touched an hour ago belongs above a canvas last opened in
 * March, and grouping by source puts the section first and the answer second.
 */
export function sortCreationLibrary(entries) {
    return [...entries].sort(compareCreationLibraryEntries);
}
/** How many entries each facet holds — including the facets holding none, so a
 *  filter can say what pressing it would reveal rather than guessing. */
export function creationLibraryFacetCounts(entries) {
    const counts = Object.fromEntries(CREATION_LIBRARY_FACETS.map((facet) => [facet, 0]));
    for (const entry of entries)
        counts[entry.facet] += 1;
    return counts;
}
/**
 * Every record ref a board already holds a card for.
 *
 * A record whose ref is in here must NOT get a row of its own: opening that row and
 * opening the board land in the same place, so a second row is two doors into one
 * room. Built with `formatResourceRef` rather than a template string for the reason
 * that function exists — `` `${null}:${null}` `` is the valid-looking key
 * `"null:null"`, which every card WITHOUT a record would otherwise share, collapsing
 * the set to one entry and suppressing rows at random.
 */
export function representedResourceRefs(boards) {
    const refs = new Set();
    for (const board of boards) {
        for (const card of board.preview?.objects ?? []) {
            const ref = formatResourceRef(card.resourceType, card.resourceId);
            if (ref)
                refs.add(ref);
        }
    }
    return refs;
}
//# sourceMappingURL=creationLibrary.js.map