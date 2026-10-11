/** Test double for `rrweb`. Production IIFE bundles the real package. */
export function record(_opts: { emit: (event: unknown) => void }): () => void {
  return () => {};
}
