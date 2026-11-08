import { describe, expect, it } from 'vitest';
import {
  BLOCKING_SEVERITIES, evaluateSecurityGate, incompleteScanReasons, isBlockingFinding, REQUIRED_SCAN_TYPES, securityMergeGate,
  type GateScanRow, type SecurityGateInput,
} from './securityMergeGate';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const scan = (scanType: string, over: Partial<GateScanRow> = {}): GateScanRow =>
  ({ scanType, status: 'completed', truncated: false, headSha: HEAD, segmentId: 'seg', ...over });
const allScans = (over: Partial<GateScanRow> = {}): GateScanRow[] => REQUIRED_SCAN_TYPES.map((t) => scan(t, over));
const gate = (over: Partial<SecurityGateInput> = {}) =>
  evaluateSecurityGate({ currentHeadSha: HEAD, scans: allScans(), findings: [], overrideShas: [], ...over });
const blockedReasons = (v: ReturnType<typeof gate>): string[] => (v.allow ? [] : v.reasons.map((r) => r.message));
const blockedCodes = (v: ReturnType<typeof gate>): string[] => (v.allow ? [] : v.reasons.map((r) => r.code));

describe('evaluateSecurityGate - the complete verdict (fails closed)', () => {
  it('allows only when all four scans completed untruncated for the current head and nothing blocks', () => {
    expect(gate()).toEqual({ allow: true });
  });

  it('blocks when a required scan row is MISSING, naming it', () => {
    const v = gate({ scans: allScans().filter((s) => s.scanType !== 'SCA') });
    expect(v.allow).toBe(false);
    expect(blockedReasons(v)).toEqual(['SCA scan has not run for this commit']);
    // the reason is DATA: a code and the scan type, not a sentence the UI has to display
    expect(!v.allow && v.reasons).toEqual([{ code: 'scan_missing', scanType: 'SCA', message: 'SCA scan has not run for this commit' }]);
  });

  it.each([
    ['skipped', 'scan_skipped'], ['failed', 'scan_failed'], ['running', 'scan_pending'],
  ])('a %s scan is the structured reason %s', (status, code) => {
    const v = gate({ scans: [...allScans().filter((s) => s.scanType !== 'SAST'), scan('SAST', { status })] });
    expect(!v.allow && v.reasons).toEqual([expect.objectContaining({ code, scanType: 'SAST' })]);
  });

  it('truncated, no-segment and unreadable-head each have their own code', () => {
    expect(blockedCodes(gate({ scans: allScans({ truncated: true }) }))).toEqual(Array(4).fill('scan_truncated'));
    expect(blockedCodes(gate({ scans: allScans({ segmentId: null }) }))).toEqual(Array(4).fill('scan_no_segment'));
    expect(blockedCodes(gate({ currentHeadSha: null }))).toEqual(['no_head']);
  });

  it('blocks with no rows at all (a PR nobody scanned is not a clean PR)', () => {
    const v = gate({ scans: [] });
    expect(blockedReasons(v)).toHaveLength(REQUIRED_SCAN_TYPES.length);
  });

  it.each([
    ['skipped', /SAST scan was skipped/],
    ['failed', /SAST scan failed/],
    ['running', /SAST scan is still pending/],
  ])('blocks on a %s scan', (status, why) => {
    const v = gate({ scans: [...allScans().filter((s) => s.scanType !== 'SAST'), scan('SAST', { status })] });
    expect(v.allow).toBe(false);
    expect(blockedReasons(v).join('|')).toMatch(why);
  });

  it('blocks on a TRUNCATED scan - completed but it did not see everything', () => {
    const v = gate({ scans: [...allScans().filter((s) => s.scanType !== 'REVIEW'), scan('REVIEW', { truncated: true })] });
    expect(blockedReasons(v).join('|')).toMatch(/REVIEW scan was incomplete/);
  });

  it('a review that timed out (recorded failed) blocks even though the other three are clean', () => {
    const v = gate({ scans: [...allScans().filter((s) => s.scanType !== 'REVIEW'), scan('REVIEW', { status: 'failed' })] });
    expect(v.allow).toBe(false);
  });

  it('blocks a scan with no segment', () => {
    const v = gate({ scans: allScans({ segmentId: null }) });
    expect(blockedReasons(v).join('|')).toMatch(/no segment/);
  });

  it('a STALE head blocks: scans of an older commit do not count for the new one', () => {
    const v = gate({ scans: allScans({ headSha: OLD }) });
    expect(v.allow).toBe(false);
    expect(blockedReasons(v)).toHaveLength(REQUIRED_SCAN_TYPES.length);
  });

  it('blocks when the head commit could not be read at all', () => {
    const v = gate({ currentHeadSha: null });
    expect(blockedReasons(v)[0]).toMatch(/head commit could not be read/);
  });

  it('an open blocking finding at the current head blocks; one at a stale head does not', () => {
    const f = { severity: 'CRITICAL', status: 'open', title: 'Key committed' };
    expect(gate({ findings: [{ ...f, headSha: HEAD }] }).allow).toBe(false);
    expect(gate({ findings: [{ ...f, headSha: OLD }] }).allow).toBe(true);
  });

  it('a manager override allows - for THAT commit only', () => {
    const broken = { scans: [] as GateScanRow[] };
    expect(gate({ ...broken, overrideShas: [HEAD] })).toEqual({ allow: true, overridden: true });
    expect(gate({ ...broken, overrideShas: [OLD] }).allow).toBe(false);
  });

  it('incompleteScanReasons is empty exactly when evidence may be written', () => {
    expect(incompleteScanReasons({ currentHeadSha: HEAD, scans: allScans() })).toEqual([]);
    expect(incompleteScanReasons({ currentHeadSha: HEAD, scans: allScans({ truncated: true }) })).not.toEqual([]);
  });
});

const f = (severity: string, status = 'open', extra: Record<string, unknown> = {}) =>
  ({ severity, status, title: `${severity} thing`, ...extra });

describe('securityMergeGate', () => {
  it('allows a PR with no findings', () => {
    expect(securityMergeGate([])).toEqual({ allow: true });
  });

  it('blocks on an open CRITICAL finding and says why', () => {
    const v = securityMergeGate([f('CRITICAL', 'open', { filePath: 'src/a.ts' })]);
    expect(v.allow).toBe(false);
    if (!v.allow) {
      expect(v.reasons[0]!.message).toContain('CRITICAL scan finding: CRITICAL thing (src/a.ts)');
      // structured, so the UI can word it in the viewer's language
      expect(v.reasons[0]).toMatchObject({ code: 'open_blocker', severity: 'CRITICAL', source: 'scan', detail: 'CRITICAL thing (src/a.ts)' });
    }
  });

  it('blocks on an open HIGH security-review finding and labels it as a review', () => {
    const v = securityMergeGate([f('high', 'open', { category: 'SECURITY' })]);
    expect(v.allow).toBe(false);
    if (!v.allow) {
      expect(v.reasons[0]!.message).toContain('security review finding');
      expect(v.reasons[0]).toMatchObject({ code: 'open_blocker', source: 'review', severity: 'HIGH' });
    }
  });

  it('does not block on MEDIUM or LOW', () => {
    expect(securityMergeGate([f('MEDIUM'), f('LOW')])).toEqual({ allow: true });
  });

  it('stops blocking once a finding is triaged away', () => {
    for (const status of ['fixed', 'accepted_risk', 'false_positive']) {
      expect(securityMergeGate([f('CRITICAL', status)])).toEqual({ allow: true });
    }
  });

  it('keeps a merely acknowledged (triaged) blocker blocking', () => {
    expect(isBlockingFinding({ severity: 'CRITICAL', status: 'triaged' })).toBe(true);
  });

  it('caps the reasons it surfaces', () => {
    const many = Array.from({ length: 9 }, () => f('CRITICAL'));
    const v = securityMergeGate(many);
    expect(v.allow).toBe(false);
    if (!v.allow) {
      expect(v.reasons).toHaveLength(6);
      expect(v.reasons[5]).toMatchObject({ code: 'open_blocker_more', count: 4 });
    }
  });

  it('maps BLOCKER onto the existing severities only', () => {
    expect([...BLOCKING_SEVERITIES]).toEqual(['CRITICAL', 'HIGH']);
  });
});
