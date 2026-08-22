/**
 * The browser half of passkeys.
 *
 * The WebAuthn browser API speaks `ArrayBuffer` and the wire speaks base64url, so
 * something has to translate. That translation is here, in ONE place, rather than
 * inside each component that calls `navigator.credentials` — getting it wrong
 * produces an assertion that fails verification with no useful message, which is
 * the single most confusing failure mode this feature has.
 *
 * `isPasskeySupported()` is what every surface should gate on. A passkey control
 * shown in a browser that cannot mint one is a dead button, and the honest
 * behaviour is to not offer it.
 */

import { AUTH_API_URL } from './auth';
import { fetchWithTransportReport } from './errors/transportFailure';

export function base64UrlToBuffer(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** True when this browser can actually create and use a passkey. */
export function isPasskeySupported(): boolean {
  return typeof window !== 'undefined'
    && typeof window.PublicKeyCredential !== 'undefined'
    && typeof navigator.credentials?.create === 'function';
}

/**
 * True when the device has a built-in authenticator (Touch ID, Windows Hello, a
 * phone's screen lock). Used to word the invitation accurately rather than
 * promising a fingerprint prompt to somebody who will be asked for a USB key.
 */
export async function hasPlatformAuthenticator(): Promise<boolean> {
  if (!isPasskeySupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    // An older browser that has the constructor but not the probe. Treating the
    // absence of an answer as "no platform authenticator" is the safe wording.
    return false;
  }
}

interface ServerRegistrationOptions {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  timeout: number;
  attestation: 'none';
  excludeCredentials: { type: 'public-key'; id: string }[];
  authenticatorSelection: { residentKey: 'preferred'; userVerification: 'preferred' };
}

interface ServerAuthenticationOptions {
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: 'preferred';
  allowCredentials: { type: 'public-key'; id: string }[];
}

/** Every base64url field the browser expects as a buffer, decoded in one place. */
function toCreationOptions(options: ServerRegistrationOptions): PublicKeyCredentialCreationOptions {
  return {
    challenge: base64UrlToBuffer(options.challenge),
    rp: options.rp,
    user: {
      id: base64UrlToBuffer(options.user.id),
      name: options.user.name,
      displayName: options.user.displayName,
    },
    pubKeyCredParams: options.pubKeyCredParams,
    timeout: options.timeout,
    attestation: options.attestation,
    excludeCredentials: options.excludeCredentials.map((c) => ({ type: c.type, id: base64UrlToBuffer(c.id) })),
    authenticatorSelection: options.authenticatorSelection,
  };
}

function toRequestOptions(options: ServerAuthenticationOptions): PublicKeyCredentialRequestOptions {
  return {
    challenge: base64UrlToBuffer(options.challenge),
    rpId: options.rpId,
    timeout: options.timeout,
    userVerification: options.userVerification,
    allowCredentials: options.allowCredentials.map((c) => ({ type: c.type, id: base64UrlToBuffer(c.id) })),
  };
}

export interface CreatedPasskey {
  id: string;
  rawId: string;
  response: { clientDataJSON: string; attestationObject: string; transports: string[] };
}

export async function createPasskeyCredential(options: ServerRegistrationOptions): Promise<CreatedPasskey> {
  const credential = await navigator.credentials.create({ publicKey: toCreationOptions(options) });
  if (!credential) throw new Error('cancelled');

  const attestation = credential as PublicKeyCredential;
  const response = attestation.response as AuthenticatorAttestationResponse;

  return {
    id: attestation.id,
    rawId: bufferToBase64Url(attestation.rawId),
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      attestationObject: bufferToBase64Url(response.attestationObject),
      transports: typeof response.getTransports === 'function' ? response.getTransports() : [],
    },
  };
}

export interface PasskeyAssertionPayload {
  id: string;
  rawId: string;
  response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle: string | null };
}

export async function getPasskeyAssertion(options: ServerAuthenticationOptions): Promise<PasskeyAssertionPayload> {
  const credential = await navigator.credentials.get({ publicKey: toRequestOptions(options) });
  if (!credential) throw new Error('cancelled');

  const assertion = credential as PublicKeyCredential;
  const response = assertion.response as AuthenticatorAssertionResponse;

  return {
    id: assertion.id,
    rawId: bufferToBase64Url(assertion.rawId),
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      authenticatorData: bufferToBase64Url(response.authenticatorData),
      signature: bufferToBase64Url(response.signature),
      userHandle: response.userHandle ? bufferToBase64Url(response.userHandle) : null,
    },
  };
}

/**
 * A person dismissing the system prompt is not an error worth showing an error
 * banner for — it is them changing their mind. Everything else is.
 */
export function isPasskeyCancellation(error: unknown): boolean {
  if (error instanceof Error && error.message === 'cancelled') return true;
  return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError');
}

// ---------------------------------------------------------------------------
// Sign-in — deliberately NOT in `builderforceApi.ts`
// ---------------------------------------------------------------------------

/**
 * The sign-in half sits beside `lib/auth.ts`'s other unauthenticated calls rather
 * than in the typed client, because the typed client attaches a session token and
 * this runs before there is one.
 */
export interface PasskeyLoginResult {
  token: string;
  user: Record<string, unknown>;
}

export async function signInWithPasskey(email?: string): Promise<PasskeyLoginResult> {
  const optionsRes = await fetchWithTransportReport(`${AUTH_API_URL}/api/auth/passkey/options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(email ? { email } : {}),
  });
  const optionsBody = await optionsRes.json().catch(() => ({})) as { options?: ServerAuthenticationOptions; error?: string };
  if (!optionsRes.ok || !optionsBody.options) throw new Error(optionsBody.error ?? 'Passkey sign-in is unavailable');

  const assertion = await getPasskeyAssertion(optionsBody.options);

  const verifyRes = await fetchWithTransportReport(`${AUTH_API_URL}/api/auth/passkey/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(assertion),
  });
  const verifyBody = await verifyRes.json().catch(() => ({})) as { token?: string; user?: Record<string, unknown>; error?: string };
  if (!verifyRes.ok || !verifyBody.token || !verifyBody.user) {
    throw new Error(verifyBody.error ?? 'That passkey could not be used to sign in');
  }
  return { token: verifyBody.token, user: verifyBody.user };
}
