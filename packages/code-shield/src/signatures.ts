import type { Rule } from './rules/rule.js';

/** Known-malicious SHA-256 digests. Seeded with the harmless EICAR antivirus test file. */
export const KNOWN_BAD_SHA256: ReadonlySet<string> = new Set([
  '275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f',
]);

/** A feed of bad digests (OpenSSF malicious-packages, MalwareBazaar …) plugs in behind this. */
export interface SignatureSource {
  has(sha256: string): boolean;
}

export const BUILT_IN_SIGNATURES: SignatureSource = { has: (sha256) => KNOWN_BAD_SHA256.has(sha256) };

/** The EICAR test string, matched as a pattern so a file merely CONTAINING it (not only equal to it) is caught. */
export const EICAR_RULE: Rule = {
  id: 'signature.eicar', category: 'malware-signature', severity: 'CRITICAL', weight: 100, scope: 'source', paths: 'any',
  title: 'EICAR antivirus test signature',
  // Built from pieces so this source file does not itself carry the literal string.
  pattern: new RegExp(['X5O!P%@AP\\[4\\\\PZX54\\(P\\^\\)7CC\\)7\\}\\$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!', '\\$H\\+H\\*'].join('')),
  remediation: 'Remove the file; it is the standard antivirus test signature.',
};

export const SIGNATURE_RULES: readonly Rule[] = [EICAR_RULE];

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
