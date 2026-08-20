/**
 * tlsCertificateScan — the PURE half of the peer-certificate / transport stage of
 * the web security scan.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM {@link ./WebSecurityScanner}
 * The Worker scan cannot do this check at all. Cloudflare Worker `fetch` never
 * surfaces the peer certificate — there is no socket object, no `getPeerCertificate`,
 * no negotiated cipher — so "your certificate expires in 6 days" and "you still
 * negotiate TLS 1.0" were permanently invisible to a scan that runs inside the
 * Worker. That is a runtime limitation, not a missing feature, and no amount of
 * Worker-side code fixes it. The observation therefore has to come from a Node
 * process that CAN open a socket (`node:tls` → `socket.getPeerCertificate()`), which
 * for this platform is the agent container (`api/container/server.mjs`).
 *
 * What stays here is everything that is a DECISION rather than an observation:
 * given a description of a certificate and a negotiated socket, which findings does
 * it raise? That is pure — no socket, no clock beyond the `now` handed in, no DB —
 * so the whole judgement is unit-testable without a network, exactly like
 * `evaluateHeaders`. The container ships an OBSERVATION, never a verdict; if the
 * container ever drifted from the platform's idea of "weak", the drift would be
 * invisible because the verdict would have been computed out of reach of the tests.
 *
 * Findings use the SAME {@link WebFinding} shape, the same severity vocabulary and
 * the same `[web:<checkId>:<origin>]` dedupe marker as every other web-scan check,
 * so they file through the same SecurityAuditService pipeline into the same board.
 * There is no second finding path and no second severity scale.
 */
import { makeWebFinding, type ScanContext, type WebFinding } from './WebSecurityScanner';

/**
 * One peer certificate as a Node TLS socket describes it. Field names deliberately
 * mirror `tls.PeerCertificate` (`valid_from` / `valid_to` keep their snake_case
 * spelling) so the container edge can forward what it read without a lossy rename
 * that would invite a transcription bug between the two sides.
 */
export interface PeerCertificateDescription {
  /** Subject CN, e.g. `example.com`. Null when the subject carries no CN. */
  subjectCommonName: string | null;
  /** DNS names from the subjectAltName extension, already split and lowercased. */
  subjectAltNames: string[];
  issuerCommonName: string | null;
  issuerOrganization: string | null;
  /** Node's `valid_from` — e.g. `Mar  1 00:00:00 2026 GMT`. Parsed by `Date`. */
  valid_from: string;
  /** Node's `valid_to`. */
  valid_to: string;
  /** e.g. `sha256WithRSAEncryption`. Null when the socket did not report it. */
  signatureAlgorithm: string | null;
  /** `rsa` | `ec` | `ed25519` …, as reported by the socket. */
  publicKeyType: string | null;
  /** Key size in bits (RSA modulus / EC curve size). */
  publicKeyBits: number | null;
  /** True when subject === issuer, i.e. the leaf signed itself. */
  selfSigned: boolean;
}

/** The negotiated connection plus the certificate it presented. */
export interface TlsObservation {
  /** The host the socket connected to — the name the certificate must match. */
  host: string;
  port: number;
  /** `TLSv1.3` / `TLSv1.2` / `TLSv1.1` / `TLSv1` / `SSLv3`, or null. */
  protocol: string | null;
  /** OpenSSL cipher name, e.g. `ECDHE-RSA-AES128-GCM-SHA256`. */
  cipherName: string | null;
  /** IANA cipher name when the socket reports one, e.g. `TLS_AES_256_GCM_SHA384`. */
  cipherStandardName: string | null;
  /** Node's chain verification verdict (`socket.authorized`). */
  authorized: boolean;
  /** Node's verification failure code, e.g. `DEPTH_ZERO_SELF_SIGNED_CERT`. */
  authorizationError: string | null;
  certificate: PeerCertificateDescription | null;
  /** Set when the handshake itself never completed (connect refused / timeout / alert). */
  handshakeError: string | null;
}

/**
 * How close to expiry counts as "expiring soon". 30 days is the window in which a
 * renewal that has silently stopped working still leaves time to fix it by hand —
 * the failure this check exists to prevent is the Monday-morning outage caused by a
 * cert everybody assumed auto-renewed.
 */
export const CERT_EXPIRY_WARN_DAYS = 30;

/** RSA below this is below every current CA baseline requirement. */
const MIN_RSA_BITS = 2048;
/** EC below this is below the 128-bit security level (P-256). */
const MIN_EC_BITS = 256;

/**
 * Protocol versions ranked so "older than TLS 1.2" is one comparison rather than a
 * scatter of string equality checks. Anything not listed is treated as UNKNOWN and
 * raises nothing — guessing about a protocol we cannot name would be a false
 * positive on a runtime that spells its versions differently.
 */
const PROTOCOL_RANK: Record<string, number> = {
  'sslv2': 10, 'sslv3': 20, 'tlsv1': 30, 'tlsv1.0': 30, 'tlsv1.1': 40, 'tlsv1.2': 50, 'tlsv1.3': 60,
};
/** TLS 1.2 is the floor: 1.1 and below are deprecated by RFC 8996 and PCI DSS. */
const MIN_ACCEPTABLE_PROTOCOL_RANK = 50;

/** Rank a protocol string, or null when it is not one we recognise. */
export function protocolRank(protocol: string | null | undefined): number | null {
  if (!protocol) return null;
  return PROTOCOL_RANK[protocol.trim().toLowerCase()] ?? null;
}

/**
 * Cipher tokens that mark a suite as weak. Matched against BOTH the OpenSSL and the
 * IANA spelling because the two disagree on nearly every name (`DES-CBC3-SHA` vs
 * `TLS_RSA_WITH_3DES_EDE_CBC_SHA`), and a check that only knew one spelling would
 * pass a weak suite whenever the socket happened to report the other.
 */
const WEAK_CIPHER_TOKENS = ['rc4', '3des', 'des-', '_des_', 'null', 'export', 'md5', 'anon', 'idea', 'seed', 'psk_with_null'];

/** True when the negotiated suite uses a broken primitive. */
export function isWeakCipher(cipherName: string | null, standardName: string | null): boolean {
  const haystack = `${cipherName ?? ''} ${standardName ?? ''}`.toLowerCase();
  if (!haystack.trim()) return false;
  return WEAK_CIPHER_TOKENS.some((token) => haystack.includes(token));
}

/** Signature algorithms whose collision resistance is broken (SHAttered / chosen-prefix). */
export function isWeakSignatureAlgorithm(sigAlg: string | null): boolean {
  if (!sigAlg) return false;
  const s = sigAlg.toLowerCase();
  return s.includes('md5') || s.includes('md2') || (s.includes('sha1') || s.includes('sha-1'));
}

/** True when the key is below the current baseline for its type. */
export function isWeakKey(type: string | null, bits: number | null): boolean {
  if (bits == null || bits <= 0) return false;
  const t = (type ?? '').toLowerCase();
  if (t.includes('ec')) return bits < MIN_EC_BITS;
  if (t.includes('ed')) return false; // Ed25519 is fixed-size and strong at 256.
  // Default to the RSA baseline: an unnamed type with a modulus-sized `bits` is
  // overwhelmingly RSA, and treating a 1024-bit key as fine because the socket did
  // not label it would be the wrong way to be wrong.
  return bits < MIN_RSA_BITS;
}

/**
 * Does `host` match one of the certificate's names? Implements the RFC 6125 rule the
 * browser applies: SAN entries win outright, and a wildcard matches exactly ONE
 * left-most label (so `*.example.com` covers `www.example.com` but not
 * `a.b.example.com` and not the bare `example.com`). CN is consulted only when the
 * certificate has no SAN entries at all, which is how every current browser behaves.
 */
export function matchesCertificateHost(host: string, cert: PeerCertificateDescription): boolean {
  const target = host.trim().toLowerCase().replace(/\.$/, '');
  if (!target) return false;
  const names = cert.subjectAltNames.length > 0
    ? cert.subjectAltNames
    : (cert.subjectCommonName ? [cert.subjectCommonName] : []);
  return names.some((raw) => {
    const name = raw.trim().toLowerCase().replace(/^dns:/, '').replace(/\.$/, '');
    if (!name) return false;
    if (name === target) return true;
    if (!name.startsWith('*.')) return false;
    const suffix = name.slice(1); // '.example.com'
    if (!target.endsWith(suffix)) return false;
    const label = target.slice(0, target.length - suffix.length);
    // Exactly one label, and a wildcard never covers the bare domain.
    return label.length > 0 && !label.includes('.');
  });
}

/** Whole days from `now` until the certificate stops being valid (negative = expired). */
export function certificateDaysRemaining(cert: PeerCertificateDescription, now: Date): number | null {
  const expiry = Date.parse(cert.valid_to);
  if (Number.isNaN(expiry)) return null;
  return Math.floor((expiry - now.getTime()) / 86_400_000);
}

/** Certificate authority label for a finding body — issuer O, else CN, else "unknown". */
function issuerLabel(cert: PeerCertificateDescription): string {
  return cert.issuerOrganization?.trim() || cert.issuerCommonName?.trim() || 'an unidentified issuer';
}

/**
 * Turn one TLS observation into findings. PURE — `now` is injected so an expiry test
 * is not a time bomb that starts failing when the fixture certificate ages out.
 *
 * SEVERITY MAPPING. Anything that makes a browser refuse the connection outright
 * (expired, wrong host, untrusted chain) is `critical`/`high` and maps to the
 * `availability` criterion where the user-visible consequence is "the site is
 * unreachable" — an expired certificate is an OUTAGE, not merely a weakness. The
 * cryptographic weaknesses (old protocol, weak suite, small key, SHA-1 signature)
 * are `medium` under `security`: the site still loads, but the transport does not
 * carry the guarantee it appears to.
 */
export function evaluateTls(ctx: ScanContext, obs: TlsObservation, now: Date): WebFinding[] {
  const out: WebFinding[] = [];
  const make = (
    checkId: string,
    severity: Parameters<typeof makeWebFinding>[2],
    tsc: Parameters<typeof makeWebFinding>[3],
    title: string,
    detail: string,
    recommendation: string,
  ) => out.push(makeWebFinding(ctx.origin, checkId, severity, tsc, title, detail, recommendation));

  // A handshake that never completed is reported as itself. Silence here would be
  // indistinguishable from "the TLS stage found nothing wrong", which is the exact
  // ambiguity the stage report exists to remove.
  if (obs.handshakeError) {
    make('tls-handshake-failed', 'high', 'availability',
      'TLS handshake failed',
      `A TLS connection to \`${obs.host}:${obs.port}\` could not be completed: ${obs.handshakeError}. Visitors reaching the site over HTTPS see the same failure.`,
      'Check that the HTTPS listener is up, that the certificate and its intermediate chain are installed, and that the host is reachable on port 443.');
    return out;
  }

  const cert = obs.certificate;

  // ── Protocol + suite: judged from the socket, independent of the certificate ──
  const rank = protocolRank(obs.protocol);
  if (rank != null && rank < MIN_ACCEPTABLE_PROTOCOL_RANK) {
    make('tls-weak-protocol', 'high', 'security',
      'Connection negotiated a deprecated TLS version',
      `The server negotiated \`${obs.protocol}\`. TLS 1.1 and below are deprecated (RFC 8996) and prohibited by PCI DSS — their cipher suites and handshake integrity are broken, and major browsers already refuse them.`,
      'Disable SSLv3/TLS 1.0/TLS 1.1 at the web server or CDN and require TLS 1.2 as the minimum, preferring TLS 1.3.');
  }
  if (isWeakCipher(obs.cipherName, obs.cipherStandardName)) {
    make('tls-weak-cipher', 'medium', 'security',
      'Connection negotiated a weak cipher suite',
      `The negotiated suite is \`${obs.cipherStandardName ?? obs.cipherName}\`, which relies on a broken or export-grade primitive (RC4, 3DES, single DES, NULL encryption, anonymous key exchange, or an MD5 MAC). Traffic protected by it is not meaningfully confidential.`,
      'Restrict the cipher list to modern AEAD suites (AES-GCM / ChaCha20-Poly1305) with forward secrecy, and remove RC4, 3DES, DES, NULL, EXPORT and anonymous suites.');
  }

  if (!cert) {
    // Authorized-but-no-certificate cannot happen on a real socket; treat a missing
    // certificate as an observation gap and say so rather than inventing a verdict.
    make('tls-no-certificate', 'medium', 'security',
      'No peer certificate could be read',
      `The TLS connection to \`${obs.host}:${obs.port}\` completed but presented no readable certificate, so expiry, issuer and hostname could not be verified.`,
      'Confirm the server sends its full certificate chain on every handshake, including the intermediate certificates.');
    return out;
  }

  // ── Validity window ────────────────────────────────────────────────────────
  const days = certificateDaysRemaining(cert, now);
  if (days != null && days < 0) {
    make('tls-cert-expired', 'critical', 'availability',
      'TLS certificate has expired',
      `The certificate for \`${obs.host}\` expired on ${cert.valid_to} (${Math.abs(days)} day(s) ago). Every browser now shows a full-page interstitial before the site loads, and API clients fail their TLS verification outright.`,
      'Renew and install the certificate now, then automate renewal (ACME/Let\'s Encrypt or the CDN\'s managed certificate) and alert on days-to-expiry.');
  } else if (days != null && days <= CERT_EXPIRY_WARN_DAYS) {
    make('tls-cert-expiring', 'medium', 'availability',
      'TLS certificate expires soon',
      `The certificate for \`${obs.host}\` expires on ${cert.valid_to} — ${days} day(s) from now. Issued by ${issuerLabel(cert)}.`,
      `Confirm automated renewal is actually running (a renewal that silently stopped is the usual cause) and alert at least ${CERT_EXPIRY_WARN_DAYS} days before expiry.`);
  }
  const notBefore = Date.parse(cert.valid_from);
  if (!Number.isNaN(notBefore) && notBefore > now.getTime()) {
    make('tls-cert-not-yet-valid', 'high', 'availability',
      'TLS certificate is not yet valid',
      `The certificate for \`${obs.host}\` is not valid until ${cert.valid_from}. Clients reject it until then — usually a clock skew on the server or a certificate installed ahead of its start date.`,
      'Install the currently-valid certificate and check the server clock (NTP) — a fast clock makes a valid certificate look future-dated.');
  }

  // ── Identity ───────────────────────────────────────────────────────────────
  if (!matchesCertificateHost(obs.host, cert)) {
    const names = cert.subjectAltNames.length > 0 ? cert.subjectAltNames : [cert.subjectCommonName ?? '(none)'];
    make('tls-hostname-mismatch', 'high', 'security',
      'TLS certificate does not cover the scanned hostname',
      `The certificate presented for \`${obs.host}\` is valid for ${names.map((n) => `\`${n}\``).join(', ')}. Browsers refuse the connection, and users trained to click through the warning cannot tell this apart from an interception attack.`,
      'Reissue the certificate with the served hostname in its subjectAltName list (or route the hostname to the listener that already holds the right certificate).');
  }

  // ── Chain trust ────────────────────────────────────────────────────────────
  if (cert.selfSigned) {
    make('tls-self-signed', 'high', 'security',
      'TLS certificate is self-signed',
      `The certificate for \`${obs.host}\` was issued by itself, so no certificate authority vouches for it. It provides encryption but no identity guarantee — an attacker who intercepts the connection can present their own self-signed certificate and look identical.`,
      'Replace it with a certificate from a publicly-trusted CA (a free automated ACME certificate is sufficient) for anything a browser or third-party client reaches.');
  } else if (!obs.authorized) {
    make('tls-untrusted-chain', 'high', 'security',
      'TLS certificate chain did not verify',
      `Chain verification for \`${obs.host}\` failed: ${obs.authorizationError ?? 'the issuing chain could not be built to a trusted root'}. The most common cause is a missing intermediate certificate — which typically still works in the browser that cached it and fails for every API client and mobile app.`,
      'Install the full chain (leaf + every intermediate, in order) on the listener, then re-test from a client with a clean trust store.');
  }

  // ── Cryptographic strength of the certificate itself ───────────────────────
  if (isWeakSignatureAlgorithm(cert.signatureAlgorithm)) {
    make('tls-weak-signature', 'medium', 'security',
      'TLS certificate uses a weak signature algorithm',
      `The certificate is signed with \`${cert.signatureAlgorithm}\`. SHA-1 and MD5 are broken against chosen-prefix collisions, so a forged certificate carrying the same signature is computationally feasible.`,
      'Reissue the certificate with a SHA-256 (or stronger) signature; every current CA issues SHA-256 by default.');
  }
  if (isWeakKey(cert.publicKeyType, cert.publicKeyBits)) {
    make('tls-weak-key', 'medium', 'security',
      'TLS certificate uses an undersized key',
      `The certificate carries a ${cert.publicKeyBits}-bit ${cert.publicKeyType ?? 'RSA'} key, below the current baseline (${MIN_RSA_BITS}-bit RSA / ${MIN_EC_BITS}-bit EC). Undersized keys are within reach of a well-resourced attacker and are already rejected by some clients.`,
      `Reissue with at least a ${MIN_RSA_BITS}-bit RSA key, or a P-256 EC key (smaller, faster, and stronger than ${MIN_RSA_BITS}-bit RSA).`);
  }

  return out;
}
