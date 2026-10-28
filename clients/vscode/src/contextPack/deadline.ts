/** The context pack's own deadline, shared with the prefetch rows that run inside it. Kept
 *  free of any `vscode` import so pure modules (and their tests) can read it. */
export const CONTEXT_PACK_DEADLINE_MS = 1_500;
