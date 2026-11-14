/**
 * The vocabulary a catalog row is described in — what a model is FOR, and the shape of
 * one generated WebLLM entry. Its own module so the generated data
 * (`webllmCatalog.generated.ts`) and the hand-written catalog (`catalog.ts`) share one
 * contract without importing each other's values.
 */
/** What a model is good at. A picker groups by it; the engines filter on it. */
export const LOCAL_MODEL_USES = ['chat', 'coding', 'reasoning', 'math', 'vision', 'embedding'];
//# sourceMappingURL=catalogEntry.js.map