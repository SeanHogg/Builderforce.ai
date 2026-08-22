/**
 * AWS Signature Version 4 request signing — pure Web Crypto, no AWS SDK (the SDK
 * pulls in Node-only APIs that don't run in a Cloudflare Worker).
 *
 * Implements the algorithm AWS documents at
 * https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html:
 * canonical request → string to sign → derived signing key (HMAC chain) →
 * signature → `Authorization` header. Used by `amazonBedrock.ts`; kept generic
 * (service/region/method are parameters) so it is not Bedrock-specific.
 */
import { sha256Hex } from '../../../infrastructure/crypto/digest';

const encoder = new TextEncoder();



async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key instanceof Uint8Array ? key : new Uint8Array(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

async function hmacHex(key: ArrayBuffer | Uint8Array, data: string): Promise<string> {
  const sig = await hmac(key, data);
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** `YYYYMMDDTHHMMSSZ` / `YYYYMMDD` — AWS's own basic ISO 8601 date formats. */
export function amzDate(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

/** URI-encode one path segment per AWS's rules (RFC 3986 unreserved set kept
 *  literal; everything else percent-encoded, including `/` when encoding a
 *  full path is not what's wanted — callers join segments themselves). */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Canonical path: each `/`-separated segment individually RFC-3986-encoded,
 *  slashes preserved. AWS requires this even though most services also accept
 *  an unencoded path — Bedrock's model-id path segment can contain `:` and `.`,
 *  which URI-encode differently, so this matters here specifically. */
export function canonicalUri(path: string): string {
  return path.split('/').map((seg) => encodeRfc3986(seg)).join('/');
}

export interface SignRequestArgs {
  method: string;
  /** Already-percent-encoded path, e.g. from {@link canonicalUri}. */
  path: string;
  /** Raw query string (no leading `?`), or ''. */
  query?: string;
  /** Header names are lower-cased and sorted by this function — pass them as
   *  written, in any case/order. `host` is required by the algorithm; add it
   *  yourself so the caller stays in control of exactly what's signed. */
  headers: Record<string, string>;
  body: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  now?: Date;
}

export interface SignedRequest {
  headers: Record<string, string>;
}

/**
 * Sign a request, returning the COMPLETE header set to send (the caller's
 * `headers` plus `x-amz-date`, `x-amz-content-sha256`, `authorization`, and
 * `x-amz-security-token` when a session token is supplied).
 */
export async function signAwsRequest(args: SignRequestArgs): Promise<SignedRequest> {
  const {
    method, path, query = '', body, region, service, accessKeyId, secretAccessKey, sessionToken,
  } = args;
  const now = args.now ?? new Date();
  const { amzDate: date, dateStamp } = amzDate(now);
  const payloadHash = await sha256Hex(body);

  const headers: Record<string, string> = {
    ...args.headers,
    'x-amz-date': date,
    'x-amz-content-sha256': payloadHash,
    ...(sessionToken ? { 'x-amz-security-token': sessionToken } : {}),
  };

  // Canonical headers: lower-cased name, trimmed value, sorted by name, one
  // per line, trailing newline after the LAST one (per AWS's spec).
  const sortedNames = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = sortedNames.map((name) => {
    const original = Object.entries(headers).find(([k]) => k.toLowerCase() === name)![1];
    return `${name}:${original.trim().replace(/\s+/g, ' ')}\n`;
  }).join('');
  const signedHeaders = sortedNames.join(';');

  const canonicalRequest = [
    method.toUpperCase(),
    path,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    date,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = await hmac(encoder.encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = await hmacHex(kSigning, stringToSign);

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, `
    + `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { headers: { ...headers, authorization } };
}
