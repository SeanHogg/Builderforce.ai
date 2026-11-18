/**
 * Per-storage version counters (PyTorch's `_version`). Every in-place write a
 * backend performs — `copyInPlace`, `addInPlace`, the optimizer steps,
 * `loraBackward` — bumps the counter of the STORAGE it writes, so a write
 * through any view of that storage (a `detach()`ed alias, a reshape) is seen
 * by every other view. Autograd records the versions of the values a grad rule
 * will read and refuses `backward` when one has moved since.
 *
 * Keyed weakly by the backend's storage object (`Backend.storageOf`), so a
 * counter lives exactly as long as its storage.
 */

const versions = new WeakMap<object, number>();

export function bumpVersion(storage: object): void {
  versions.set(storage, (versions.get(storage) ?? 0) + 1);
}

export function versionOf(storage: object): number {
  return versions.get(storage) ?? 0;
}
