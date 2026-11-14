/**
 * knowledge/claimSimilarity.ts — the review's `similar` port over a host's knowledge index
 * (PRD 38 §4.3, the compare phase).
 *
 * The review asks which of the claims it is comparing are near-duplicates of one another or
 * of earlier claims. Hosts index the graph only AFTER a review, so this run's claims are not
 * in the index when it asks: the review hands their text with the ids (memory's second
 * argument), and the index compares them with everything it holds. A review that does not
 * pass the texts (an older memory) is answered from the claims just written to the store.
 */
import { factKeyOf } from '@seanhogg/builderforce-memory/knowledge';
export function claimSimilarity(index, store, rootId) {
    return async (ids, given) => {
        if (given && given.size > 0)
            return index.similar(ids, given);
        const facts = new Map((await store.facts({ rootId })).map((f) => [f.key, f]));
        const texts = new Map();
        for (const id of ids) {
            const fact = facts.get(factKeyOf(id) ?? '');
            // A claim's content is its text, then its quote: both say what it claims.
            if (fact?.key.startsWith('claim:'))
                texts.set(id, fact.content);
        }
        return index.similar(ids, texts);
    };
}
//# sourceMappingURL=claimSimilarity.js.map