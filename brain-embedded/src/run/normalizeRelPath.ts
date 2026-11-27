import { toPosixPath } from '@builderforce/agent-tools';

/**
 * A model- or user-supplied repo path as one comparable key: trimmed, forward slashes (the platform's one
 * separator rule, `toPosixPath`), no leading `./`. ONE definition for every gate that matches paths a run
 * read, wrote or was asked about.
 */
export function normalizeRelPath(value: string): string {
  return toPosixPath(value.trim()).replace(/^\.\/+/, '');
}

/** {@link normalizeRelPath} for a directory-or-file key: the trailing `/` is dropped too (`src/` and `src` are one key). */
export function normalizeRelPathKey(value: string): string {
  return normalizeRelPath(value).replace(/\/+$/, '');
}
