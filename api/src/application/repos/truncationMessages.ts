/**
 * What to say about a file read only in part, by WHY it stopped short — the two reasons
 * call for different answers: a file past the read cap (`size`) will never be read whole
 * here, so rewrite it; a read the provider cut off (`incomplete`, e.g. rate limited) may
 * succeed if retried.
 */
import type { TruncationReason } from './sources/RepoSource';

/** `edit_file` refusing a file it could not read whole. */
export function editRefusalForTruncated(path: string, reason: TruncationReason | undefined): string {
  return reason === 'incomplete'
    ? `'${path}' could not be read completely (the provider stopped answering mid-read, e.g. rate limited) — retry edit_file shortly, or rewrite the whole file with write_file`
    : `'${path}' is too large to edit safely here — rewrite it with write_file instead`;
}

/** A security scan's read failure for a file it could read only in part. */
export function scanFailureForTruncated(path: string, reason: TruncationReason | undefined): string {
  return reason === 'incomplete'
    ? `${path}: the provider stopped answering mid-read (e.g. rate limited), so the file was only partly read`
    : `${path}: file exceeds the read limit and was only partly read`;
}
