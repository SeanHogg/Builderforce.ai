import { describe, it, expect } from 'vitest';
import {
  evaluateTls,
  matchesCertificateHost,
  certificateDaysRemaining,
  isWeakCipher,
  isWeakKey,
  isWeakSignatureAlgorithm,
  protocolRank,
  CERT_EXPIRY_WARN_DAYS,
  type PeerCertificateDescription,
  type TlsObservation,
} from './tlsCertificateScan';
import type { ScanContext } from './WebSecurityScanner';

const NOW = new Date('2026-06-01T00:00:00Z');

const ctx: ScanContext = {
  origin: 'https://example.com',
  finalUrl: 'https://example.com/',
  headers: {},
  cookies: [],
  httpProbe: 'upgraded',
};

/** A certificate with nothing wrong with it: valid for a year, real CA, SHA-256, RSA-2048. */
function goodCert(overrides: Partial<PeerCertificateDescription> = {}): PeerCertificateDescription {
  return {
    subjectCommonName: 'example.com',
    subjectAltNames: ['example.com', 'www.example.com'],
    issuerCommonName: 'R3',
    issuerOrganization: "Let's Encrypt",
    valid_from: 'Apr  1 00:00:00 2026 GMT',
    valid_to: 'Dec 31 00:00:00 2026 GMT',
    signatureAlgorithm: 'sha256WithRSAEncryption',
    publicKeyType: 'rsa',
    publicKeyBits: 2048,
    selfSigned: false,
    ...overrides,
  };
}

/** A healthy TLS 1.3 socket presenting `goodCert()`. Should yield ZERO findings. */
function goodObs(overrides: Partial<TlsObservation> = {}): TlsObservation {
  return {
    host: 'example.com',
    port: 443,
    protocol: 'TLSv1.3',
    cipherName: 'TLS_AES_256_GCM_SHA384',
    cipherStandardName: 'TLS_AES_256_GCM_SHA384',
    authorized: true,
    authorizationError: null,
    certificate: goodCert(),
    handshakeError: null,
    ...overrides,
  };
}

const ids = (obs: TlsObservation, now = NOW) => new Set(evaluateTls(ctx, obs, now).map((f) => f.checkId));

describe('matchesCertificateHost (RFC 6125 name matching)', () => {
  it('matches an exact SAN entry', () => {
    expect(matchesCertificateHost('www.example.com', goodCert())).toBe(true);
  });

  it('rejects a host no SAN covers', () => {
    expect(matchesCertificateHost('api.example.com', goodCert())).toBe(false);
  });

  it('matches a wildcard against exactly one label', () => {
    const cert = goodCert({ subjectAltNames: ['*.example.com'] });
    expect(matchesCertificateHost('www.example.com', cert)).toBe(true);
    // A wildcard covers neither the bare domain nor a deeper label — the two
    // mistakes that turn a mismatch into a false pass.
    expect(matchesCertificateHost('example.com', cert)).toBe(false);
    expect(matchesCertificateHost('a.b.example.com', cert)).toBe(false);
  });

  it('falls back to CN only when there are no SAN entries at all', () => {
    const cnOnly = goodCert({ subjectAltNames: [], subjectCommonName: 'legacy.example.com' });
    expect(matchesCertificateHost('legacy.example.com', cnOnly)).toBe(true);
    // With SANs present the CN is ignored, exactly as a browser ignores it.
    const withSan = goodCert({ subjectAltNames: ['other.example.com'], subjectCommonName: 'legacy.example.com' });
    expect(matchesCertificateHost('legacy.example.com', withSan)).toBe(false);
  });

  it('is case- and trailing-dot-insensitive', () => {
    expect(matchesCertificateHost('WWW.Example.COM.', goodCert())).toBe(true);
  });
});

describe('certificateDaysRemaining', () => {
  it('counts whole days to expiry', () => {
    expect(certificateDaysRemaining(goodCert({ valid_to: 'Jun 11 00:00:00 2026 GMT' }), NOW)).toBe(10);
  });

  it('goes negative once expired', () => {
    expect(certificateDaysRemaining(goodCert({ valid_to: 'May 22 00:00:00 2026 GMT' }), NOW)).toBe(-10);
  });

  it('returns null for an unparseable date rather than guessing', () => {
    expect(certificateDaysRemaining(goodCert({ valid_to: 'not a date' }), NOW)).toBeNull();
  });
});

describe('weakness predicates', () => {
  it('flags broken ciphers in either spelling', () => {
    expect(isWeakCipher('DES-CBC3-SHA', null)).toBe(true);
    expect(isWeakCipher(null, 'TLS_RSA_WITH_3DES_EDE_CBC_SHA')).toBe(true);
    expect(isWeakCipher('RC4-MD5', null)).toBe(true);
    expect(isWeakCipher('ECDHE-RSA-AES128-GCM-SHA256', null)).toBe(false);
  });

  it('flags SHA-1 and MD5 certificate signatures', () => {
    expect(isWeakSignatureAlgorithm('sha1WithRSAEncryption')).toBe(true);
    expect(isWeakSignatureAlgorithm('md5WithRSAEncryption')).toBe(true);
    expect(isWeakSignatureAlgorithm('sha256WithRSAEncryption')).toBe(false);
    expect(isWeakSignatureAlgorithm(null)).toBe(false);
  });

  it('applies the right key-size floor per key type', () => {
    expect(isWeakKey('rsa', 1024)).toBe(true);
    expect(isWeakKey('rsa', 2048)).toBe(false);
    expect(isWeakKey('ec', 224)).toBe(true);
    expect(isWeakKey('ec', 256)).toBe(false);
    // Unknown type defaults to the RSA floor rather than passing silently.
    expect(isWeakKey(null, 1024)).toBe(true);
  });

  it('ranks protocols so "older than TLS 1.2" is one comparison', () => {
    expect(protocolRank('TLSv1.1')!).toBeLessThan(protocolRank('TLSv1.2')!);
    expect(protocolRank('nonsense')).toBeNull();
  });
});

describe('evaluateTls', () => {
  it('raises nothing for a healthy certificate on a modern socket', () => {
    expect(evaluateTls(ctx, goodObs(), NOW)).toEqual([]);
  });

  it('reports a failed handshake instead of staying silent', () => {
    const findings = evaluateTls(ctx, goodObs({ handshakeError: 'ECONNREFUSED', certificate: null }), NOW);
    expect(findings.map((f) => f.checkId)).toEqual(['tls-handshake-failed']);
    expect(findings[0]!.detail).toContain('ECONNREFUSED');
  });

  it('flags an expired certificate as critical', () => {
    const findings = evaluateTls(ctx, goodObs({ certificate: goodCert({ valid_to: 'May 01 00:00:00 2026 GMT' }) }), NOW);
    const expired = findings.find((f) => f.checkId === 'tls-cert-expired');
    expect(expired?.severity).toBe('critical');
    // An expired certificate is an OUTAGE, not merely a weakness.
    expect(expired?.tsc).toBe('availability');
  });

  it('warns inside the expiry window but not outside it', () => {
    const soon = goodCert({ valid_to: 'Jun 20 00:00:00 2026 GMT' }); // 19 days
    expect(ids(goodObs({ certificate: soon }))).toContain('tls-cert-expiring');
    const later = goodCert({ valid_to: 'Sep 01 00:00:00 2026 GMT' });
    expect(ids(goodObs({ certificate: later }))).not.toContain('tls-cert-expiring');
    expect(CERT_EXPIRY_WARN_DAYS).toBe(30);
  });

  it('flags a certificate that does not cover the scanned host', () => {
    const obs = goodObs({ host: 'api.example.com' });
    expect(ids(obs)).toContain('tls-hostname-mismatch');
  });

  it('flags a self-signed leaf, and does not ALSO call it an untrusted chain', () => {
    const obs = goodObs({
      certificate: goodCert({ selfSigned: true }),
      authorized: false,
      authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    });
    const found = ids(obs);
    expect(found).toContain('tls-self-signed');
    // Two findings for one cause would double the score penalty and read as two bugs.
    expect(found).not.toContain('tls-untrusted-chain');
  });

  it('flags a chain that did not verify for any other reason', () => {
    const obs = goodObs({ authorized: false, authorizationError: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' });
    const untrusted = evaluateTls(ctx, obs, NOW).find((f) => f.checkId === 'tls-untrusted-chain');
    expect(untrusted?.detail).toContain('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
  });

  it('flags a deprecated protocol and a weak suite independently of the certificate', () => {
    const obs = goodObs({ protocol: 'TLSv1', cipherName: 'DES-CBC3-SHA', cipherStandardName: null });
    const found = ids(obs);
    expect(found).toContain('tls-weak-protocol');
    expect(found).toContain('tls-weak-cipher');
  });

  it('flags a not-yet-valid certificate (clock skew / early install)', () => {
    const obs = goodObs({ certificate: goodCert({ valid_from: 'Jul  1 00:00:00 2026 GMT' }) });
    expect(ids(obs)).toContain('tls-cert-not-yet-valid');
  });

  it('says so when no certificate could be read at all', () => {
    expect(ids(goodObs({ certificate: null }))).toContain('tls-no-certificate');
  });

  it('stamps every finding with the origin-scoped dedupe marker', () => {
    const findings = evaluateTls(ctx, goodObs({ protocol: 'TLSv1' }), NOW);
    expect(findings[0]!.marker).toBe('[web:tls-weak-protocol:https://example.com]');
  });
});
