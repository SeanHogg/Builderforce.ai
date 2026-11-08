/**
 * What a cloud run's container-git credential may push.
 *
 * The container-git proxy authenticates a run's HMAC token and then forwards with the TENANT's repository
 * credential, so the token is only as narrow as this check makes it. A run token may `receive-pack` to its OWN
 * ticket branch and nothing else: not the base branch, not another run's branch, not a tag, and not a DELETE of
 * any ref (the run branch included: it is the run's work).
 *
 * A `git-receive-pack` request body begins with pkt-line ref-update commands —
 * `<4-hex length><old-sha> <new-sha> <refname>[\0capabilities]\n` — ended by a `0000` flush, then the pack.
 * This reads exactly those commands (pure; the pack is never touched) and compares every ref.
 *
 * A body that is ONLY a flush (`0000`) carries no commands: git's remote-curl sends exactly that as its `probe_rpc`
 * when a push exceeds `http.postBuffer`, before it streams the real request. It updates nothing, so it is allowed.
 */

const FLUSH = '0000';
const COMMAND = /^([0-9a-f]{40}|[0-9a-f]{64}) ([0-9a-f]{40}|[0-9a-f]{64}) (\S+)$/;

export interface RefUpdate {
  readonly ref: string;
  readonly newSha: string;
}

/**
 * The ref updates a receive-pack body makes, `[]` for a bare flush (the probe), or null when the body is not the plain
 * command list git sends (push-cert, a truncated pkt, junk, an empty body).
 */
export function receivePackUpdates(body: Uint8Array): RefUpdate[] | null {
  const decoder = new TextDecoder('utf-8');
  const updates: RefUpdate[] = [];
  let at = 0;
  for (;;) {
    if (at + 4 > body.length) return null;
    const header = decoder.decode(body.subarray(at, at + 4));
    if (header === FLUSH) return updates.length > 0 || (at === 0 && body.length === 4) ? updates : null;
    if (!/^[0-9a-f]{4}$/.test(header)) return null;
    const length = parseInt(header, 16);
    if (length < 5 || at + length > body.length) return null;
    // Capabilities follow a NUL on the first command; the line ends with an optional LF.
    const line = (decoder.decode(body.subarray(at + 4, at + length)).split('\0')[0] ?? '').replace(/\n$/, '');
    const m = COMMAND.exec(line);
    const newSha = m?.[2];
    const ref = m?.[3];
    if (newSha === undefined || ref === undefined) return null;
    updates.push({ ref, newSha });
    at += length;
  }
}

/** The ref names a receive-pack body updates (see {@link receivePackUpdates}); `[]` for the bare-flush probe. */
export function receivePackRefs(body: Uint8Array): string[] | null {
  return receivePackUpdates(body)?.map((u) => u.ref) ?? null;
}

/** Why this push is refused (a message for the caller), or null when it only updates `branch` (or is the empty probe). */
export function receivePackDenial(body: Uint8Array, branch: string): string | null {
  const updates = receivePackUpdates(body);
  if (!updates) return 'the push request could not be read as plain ref-update commands';
  const allowed = `refs/heads/${branch}`;
  const stray = updates.find((u) => u.ref !== allowed);
  if (stray !== undefined) return `a run credential may push only ${allowed}; refused ${stray.ref}`;
  if (updates.some((u) => /^0+$/.test(u.newSha))) return `a run credential may not delete ${allowed}`;
  return null;
}
