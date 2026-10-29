/**
 * toolVocabulary — the product's words, mapped to the catalog's words, for per-turn tool
 * selection (`selectTools.ts`).
 *
 * The equivalence classes are DATA and live ONCE, in `@builderforce/agent-run`
 * (`policy/tools/toolVocabulary.ts`), where the agent's own catalog strategy reads them; the
 * Brain's selector and every other surface share that copy. This module is the Brain's
 * import path for it and holds none.
 */

export { expandWithSynonyms, synonymsFor } from '@builderforce/agent-run';
