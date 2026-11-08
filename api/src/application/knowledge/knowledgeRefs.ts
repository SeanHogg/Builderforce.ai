/** knowledgeRefs — the two parts of a `src:${rootId}::${path}` source ref (ONE parse for the blob store and the heal). */

/** The root id of a `src:${rootId}::${path}` ref, else undefined. */
export function rootOfRef(ref: string): string | undefined {
  if (!ref.startsWith('src:')) return undefined;
  const at = ref.indexOf('::');
  return at > 4 ? ref.slice(4, at) : undefined;
}

/** The path of a `src:${rootId}::${path}` ref. */
export const pathOfSourceRef = (ref: string): string => ref.slice(ref.indexOf('::') + 2);
