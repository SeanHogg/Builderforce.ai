import { describe, it, expect } from 'vitest';
import { soc2Scan, qualityScan, architectureScan, pmVisionScan, privacyScan, deriveArchitectureResult, type AuditScanContext, type ScannedRepo } from './auditScanners';

function repo(overrides: Partial<ScannedRepo> = {}): ScannedRepo {
  return {
    provider: 'github', owner: 'acme', repo: 'app', defaultBranch: 'main', read: true,
    hasCi: false, hasTests: false, hasReadme: false, hasLicense: false, hasSecurityPolicy: false,
    hasDependencyManifest: false, hasLockfile: false, hasCodeowners: false, hasContributing: false,
    suspectedSecrets: 0, fileCount: 10,
    hasPrivacyPolicy: false, hasTermsOfService: false, hasCookiePolicy: false, hasCookieConsent: false,
    hasUnsubscribe: false, hasDataExport: false, hasDataDeletion: false, hasRetentionPolicy: false,
    ...overrides,
  };
}
function ctx(repos: ScannedRepo[], extra: Partial<AuditScanContext> = {}): AuditScanContext {
  return { projectId: 1, projectName: 'Test', reposConfigured: repos.length, repos, ...extra };
}

describe('soc2Scan', () => {
  it('returns Not scored yet with no readable repos and no governance', () => {
    const r = soc2Scan(ctx([repo({ read: false })]));
    expect(r.score).toBeNull();
    expect(r.headline).toMatch(/not scored/i);
  });

  it('scores a well-controlled repo high and a bare repo low', () => {
    const good = soc2Scan(ctx([repo({ hasCi: true, hasTests: true, hasCodeowners: true, hasSecurityPolicy: true, hasContributing: true, hasLockfile: true })]));
    const bad = soc2Scan(ctx([repo({ suspectedSecrets: 2 })]));
    expect(good.score!).toBeGreaterThan(bad.score!);
    expect(good.score!).toBeGreaterThanOrEqual(1);
    expect(good.score!).toBeLessThanOrEqual(5);
    // CC families are surfaced as metrics.
    expect(good.metrics.some((m) => /CC6/.test(m.label))).toBe(true);
  });

  it('flags committed secrets as a CC6 remediation', () => {
    const r = soc2Scan(ctx([repo({ suspectedSecrets: 1 })]));
    expect(r.recommendations.some((rec) => /CC6/.test(rec.title))).toBe(true);
  });

  it('blends the governance control register when present', () => {
    const r = soc2Scan(ctx([repo({ hasCi: true })], { governance: { total: 10, implemented: 8 } }));
    expect(r.metrics.some((m) => /control/i.test(m.label))).toBe(true);
  });
});

describe('qualityScan', () => {
  it('rewards tests + CI + lockfile', () => {
    const strong = qualityScan(ctx([repo({ hasTests: true, hasCi: true, hasLockfile: true, hasContributing: true })]));
    const weak = qualityScan(ctx([repo()]));
    expect(strong.score!).toBeGreaterThan(weak.score!);
    expect(weak.recommendations.some((r) => /test/i.test(r.title))).toBe(true);
  });
});

describe('architectureScan', () => {
  it('produces a 1-5 score from structure signals', () => {
    const r = architectureScan(ctx([repo({ hasDependencyManifest: true, hasReadme: true, hasCodeowners: true, hasTests: true })]));
    expect(r.score!).toBeGreaterThanOrEqual(1);
    expect(r.score!).toBeLessThanOrEqual(5);
  });
});

describe('pmVisionScan', () => {
  it('scores planning-spine completeness', () => {
    const full = pmVisionScan(ctx([repo({ hasReadme: true })], { planning: { objectives: 3, keyResults: 3, initiatives: 2, hasVisionDoc: true, hasRoadmap: true } }));
    const empty = pmVisionScan(ctx([repo({ hasReadme: false })], { planning: { objectives: 0, keyResults: 0, initiatives: 0, hasVisionDoc: false, hasRoadmap: false } }));
    expect(full.score!).toBeGreaterThan(empty.score!);
  });
});

describe('privacyScan', () => {
  it('returns Not scored yet with no readable repos', () => {
    const r = privacyScan(ctx([repo({ read: false })]));
    expect(r.score).toBeNull();
  });

  it('scores a privacy-complete repo higher than a bare one', () => {
    const good = privacyScan(ctx([repo({ hasPrivacyPolicy: true, hasCookieConsent: true, hasCookiePolicy: true, hasDataExport: true, hasDataDeletion: true, hasUnsubscribe: true, hasRetentionPolicy: true, hasTermsOfService: true })]));
    const bad = privacyScan(ctx([repo()]));
    expect(good.score!).toBeGreaterThan(bad.score!);
    expect(good.metrics.some((m) => /CAN-SPAM/.test(m.label))).toBe(true);
  });

  it('recommends closing the missing data-subject rights', () => {
    const r = privacyScan(ctx([repo({ hasPrivacyPolicy: true })]));
    expect(r.recommendations.some((rec) => /erasure|export/i.test(rec.title))).toBe(true);
    expect(r.recommendations.some((rec) => /unsubscribe/i.test(rec.title))).toBe(true);
  });
});

describe('deriveArchitectureResult', () => {
  it('averages principle scores (0-10) onto the 1-5 scale', () => {
    const r = deriveArchitectureResult([
      { key: 'dry', label: 'DRY', score: 8 },
      { key: 'solid', label: 'SOLID', score: 6 },
    ]);
    expect(r).not.toBeNull();
    expect(r!.score).toBeCloseTo(3.5, 1); // avg 7 / 2
  });
  it('returns null when no principle scored', () => {
    expect(deriveArchitectureResult([{ key: 'dry', label: 'DRY' }])).toBeNull();
  });
});
