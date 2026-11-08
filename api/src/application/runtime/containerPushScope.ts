/**
 * What a cloud run's container-git credential may push.
 *
 * The container-git proxy authenticates a run's HMAC token and then forwards with the TENANT's repository
 * credential, so the token is only as narrow as this check makes it. A run token may `receive-pack` to its OWN
 * ticket branch and nothing else: not the base branch, not another run's branch, not a tag, not a delete.
 *
 * A `git-receive-pack` request body begins with pkt-line ref-update commands —
 * `<4-hex length><old-sha> <new-sha> <refname>[\0capabilities]\n` — ended by a `0000` flush, then the pack.
 * This reads exactly those commands (pure; the pack is never touched) and compares every ref.
 */

const FLUSH = '0000';
const COMMAND = /^([0-9a-f]{40}) ([0-9a-f]{40}) (\S+)$/;

/** The ref names a receive-pack body updates, or null when the body is not the plain command list git sends (push-cert, a truncated pkt, junk). */
export function receivePackRefs(body: Uint8Array): string[] | null {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const refs: string[] = [];
  let at = 0;
  for (;;) {
    if (at + 4 > body.length) return null;
    const header = decoder.decode(body.subarray(at, at + 4));
    if (header === FLUSH) return refs.length > 0 ? refs : null;
    if (!/^[0-9a-f]{4}$/.test(header)) return null;
    const length = parseInt(header, 16);
    if (length < 5 || at + length > body.length) return null;
    // Capabilities follow a NUL on the first command; the line ends with an optional LF.
    const line = decoder.decode(body.subarray(at + 4, at + length)).split('\0')[0].replace(/\n$/, '');
    const m = COMMAND.exec(line);
    if (!m) return null;
    refs.push(m[3]);
    at += length;
  }
}

/** Why this push is refused (a message for the caller), or null when it only updates `branch`. */
export function receivePackDenial(body: Uint8Array, branch: string): string | null {
  const refs = receivePackRefs(body);
  if (!refs) return 'the push request could not be read as plain ref-update commands';
  const allowed = `refs/heads/${branch}`;
  const stray = refs.find((r) => r !== allowed);
  return stray === undefined ? null : `a run credential may push only ${allowed}; refused ${stray}`;
}
