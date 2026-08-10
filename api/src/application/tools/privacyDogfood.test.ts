/**
 * Dogfood: run the Compliance Audit Agent diagnostic against THIS repo's
 * real file tree (the same file-path signals AuditRunner extracts from a connected
 * repo), print the actual result + the remediation tickets it would file, and
 * assert the scan produces a real 1–5 score. No DB / network — pure prod logic
 * (`signalsFromPaths` + `privacyScan`) over `git ls-files`.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { signalsFromPaths } from './AuditRunner';
import { privacyScan, type AuditScanContext, type ScannedRepo } from './auditScanners';

/** The repo's tracked files, or null when git isn't available (CI/sandbox) — the
 *  test then skips rather than fails. */
function realRepoPaths(): string[] | null {
  try {
    const repoRoot = resolve(__dirname, '../../../..'); // …/Builderforce.ai
    // Include unstaged new controls so local dogfood validates the release candidate
    // before commit; a connected GitHub audit naturally sees the committed tree.
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 }).toString();
    const paths = out.split(/\r?\n/).filter(Boolean);
    return paths.length ? paths : null;
  } catch {
    return null;
  }
}

describe('Privacy diagnostic dogfood (real repo)', () => {
  it('scores the Builderforce repo and prints the report + remediation tickets', (t) => {
    const paths = realRepoPaths();
    if (!paths) { t.skip(); return; }
    const repo: ScannedRepo = {
      provider: 'github', owner: 'SeanHogg', repo: 'Builderforce.ai', defaultBranch: 'main', read: true,
      ...signalsFromPaths(paths),
    };
    const ctx: AuditScanContext = {
      projectId: 0, projectName: 'Builderforce.ai', reposConfigured: 1, repos: [repo],
    };
    const result = privacyScan(ctx);

    // eslint-disable-next-line no-console
    console.log('\n================ COMPLIANCE AUDIT AGENT — BuilderForce.ai =======================');
    console.log(`files scanned: ${repo.fileCount}`);
    console.log(`VERDICT: ${result.headline}`);
    console.log(result.summary ?? '');
    console.log('\n-- Signals --');
    console.log(`  privacy policy .......... ${repo.hasPrivacyPolicy ? '✓' : '✗'}`);
    console.log(`  terms of service ........ ${repo.hasTermsOfService ? '✓' : '✗'}`);
    console.log(`  cookie policy ........... ${repo.hasCookiePolicy ? '✓' : '✗'}`);
    console.log(`  cookie consent surface .. ${repo.hasCookieConsent ? '✓' : '✗'}`);
    console.log(`  unsubscribe path ........ ${repo.hasUnsubscribe ? '✓' : '✗'}`);
    console.log(`  data export (portability) ${repo.hasDataExport ? '✓' : '✗'}`);
    console.log(`  data deletion (erasure) . ${repo.hasDataDeletion ? '✓' : '✗'}`);
    console.log(`  retention / purge ....... ${repo.hasRetentionPolicy ? '✓' : '✗'}`);
    console.log(`  rights request workflow . ${repo.hasRightsRequestWorkflow ? '✓' : '✗'}`);
    console.log(`  universal opt-out / GPC . ${repo.hasUniversalOptOut ? '✓' : '✗'}`);
    console.log(`  DPA / processor terms ... ${repo.hasDpa ? '✓' : '✗'}`);
    console.log(`  subprocessor register ... ${repo.hasSubprocessorRegister ? '✓' : '✗'}`);
    console.log(`  data inventory / ROPA ... ${repo.hasDataInventory ? '✓' : '✗'}`);
    console.log(`  impact assessments ...... ${repo.hasImpactAssessment ? '✓' : '✗'}`);
    console.log(`  privacy incident plan ... ${repo.hasPrivacyIncidentResponse ? '✓' : '✗'}`);
    console.log(`  AI transparency ......... ${repo.hasAiTransparency ? '✓' : '✗'}`);
    console.log(`  automated-decision guard  ${repo.hasAutomatedDecisionSafeguards ? '✓' : '✗'}`);
    console.log(`  minor safety ............ ${repo.hasMinorSafety ? '✓' : '✗'}`);
    console.log(`  transfer safeguards ..... ${repo.hasTransferSafeguards ? '✓' : '✗'}`);
    console.log(`  accessibility evidence .. ${repo.hasAccessibilityEvidence ? '✓' : '✗'}`);
    console.log('\n-- Scorecard --');
    for (const m of result.metrics) console.log(`  [L${m.tier}] ${m.label}: ${m.value}`);
    console.log(`\n-- Remediation tickets it would file (${result.recommendations.length}) --`);
    result.recommendations.forEach((r, i) => console.log(`  ${i + 1}. ${r.title}\n       ${r.detail}`));
    console.log('================================================================================\n');

    expect(typeof result.score).toBe('number');
    expect(result.score!).toBeGreaterThanOrEqual(1);
    expect(result.score!).toBeLessThanOrEqual(5);
    expect(result.metrics.length).toBeGreaterThan(0);
  });
});
