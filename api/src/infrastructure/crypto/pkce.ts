/**
 * PKCE (RFC 7636, S256) — one verifier/challenge pair for every OAuth flow.
 *
 * The Anthropic subscription connect and the MCP server connect each generated
 * their own, with their own base64url. The verifier never leaves our storage;
 * the challenge travels in the authorize URL; the token exchange presents the
 * verifier and the provider recomputes the challenge.
 */
import { randomBase64Url } from '../../domain/shared/bytes';
import { sha256Base64Url } from './digest';

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

export async function createPkcePair(): Promise<PkcePair> {
  const codeVerifier = randomBase64Url(32);
  return { codeVerifier, codeChallenge: await sha256Base64Url(codeVerifier) };
}
