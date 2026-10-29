/**
 * Which fixes a person can "Build the preview" for: a HOSTED app's fix that was applied
 * (the agent only changes the workspace — it cannot build or publish). A preview that
 * already exists is rebuilt, not hidden. Whether the coding run is still going is settled
 * after the cache by `holdBuildPreviewWhileRunning` (`prescriptionFixRuns.test.ts`).
 * `notePrescriptionPreview` accepts the publish on the same fix while it is applied.
 */
import { describe, expect, it } from 'vitest';
import { hostedContextOf, toPrescriptionDto, type PrescriptionRow } from './prescriptionReads';

const now = new Date('2026-10-12T10:00:00.000Z');
const row = (over: Partial<PrescriptionRow> = {}): PrescriptionRow => ({
  id: '11111111-2222-4333-8444-555555555555', siteId: '22222222-2222-4333-8444-555555555555', tenantId: 7,
  ruleId: 'rage_on_element', area: 'ux', source: 'rule', subjectKey: 'k', pagePath: '/checkout',
  status: 'applied', finding: { params: {}, evidence: [] }, prescription: null, change: null, visual: null,
  impact: {}, acceptance: null, measured: null, actionKind: 'fix', actionRef: 't=77', dismissReason: null, decidedBy: null,
  captureId: null, createdAt: now, updatedAt: now,
  ...over,
} as unknown as PrescriptionRow);
const HOSTED = hostedContextOf({ kind: 'hosted', projectId: 42 });

describe('buildPreview', () => {
  it('names the project when an applied fix on a hosted app has no run going and no preview yet', () => {
    expect(toPrescriptionDto(row(), 1, HOSTED).buildPreview).toEqual({ projectId: 42, rebuild: false });
  });

  it('keeps offering the build, as a rebuild, once a preview exists', () => {
    expect(toPrescriptionDto(row({ actionRef: 't=77;p=abc123def456' }), 1, HOSTED).buildPreview).toEqual({ projectId: 42, rebuild: true });
  });

  it('is null on an external site, for a fix not yet applied, and for a non-fix action', () => {
    expect(toPrescriptionDto(row(), 1, hostedContextOf({ kind: 'external', projectId: null })).buildPreview).toBeNull();
    expect(toPrescriptionDto(row({ status: 'proposed', actionKind: null, actionRef: null }), 1, HOSTED).buildPreview).toBeNull();
    expect(toPrescriptionDto(row({ actionKind: 'ticket' }), 1, HOSTED).buildPreview).toBeNull();
    expect(toPrescriptionDto(row({ status: 'measuring' }), 1, HOSTED).buildPreview).toBeNull();
  });
});

describe('hostedContextOf', () => {
  it('is hosted only with a project', () => {
    expect(hostedContextOf({ kind: 'hosted', projectId: 42 })).toEqual({ hostedCanvas: true, hostedProjectId: 42 });
    expect(hostedContextOf({ kind: 'hosted', projectId: null })).toEqual({ hostedCanvas: false, hostedProjectId: null });
    expect(hostedContextOf({ kind: 'external', projectId: 9 })).toEqual({ hostedCanvas: false, hostedProjectId: null });
  });
});
