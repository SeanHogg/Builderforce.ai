/**
 * A `ReplayPrescriptionDto` for tests (PRD 33 §5.1) — every field present, so a
 * test overrides only what it is about.
 */

import type { ReplayPrescriptionDto } from '@builderforce/interaction-contract';

export function prescription(over: Partial<ReplayPrescriptionDto> = {}): ReplayPrescriptionDto {
  return {
    id: 'rx-1',
    ruleId: 'rage_on_element',
    area: 'ux',
    source: 'rule',
    subjectKey: '/pricing|button.buy',
    pagePath: '/pricing',
    status: 'proposed',
    finding: {
      params: { route: '/pricing', label: 'Buy', share: 4.2, sessions: 120 },
      evidence: [{ recordingId: 'rec-1', atMs: 12_000 }, { recordingId: 'rec-2', atMs: 0 }],
      selector: 'button.buy',
      label: 'Buy',
      fingerprint: 'fp-rage',
      affected: 120,
    },
    prescription: 'Make the Buy button respond to the first tap #1.',
    change: { kind: 'code', target: 'button.buy', description: 'Disable the button while the order is sent.' },
    visual: null,
    impact: { estimate: 38, low: 22, high: 51, unit: 'conversions', confidence: 'medium', horizonDays: 30, estimated: true },
    actions: ['fix', 'test', 'ticket'],
    next: ['fix', 'ticket', 'dismiss'],
    actionKind: null,
    actionRef: null,
    refs: { taskId: null, testId: null, previewRelease: null, liveRelease: null, sequenceObjectId: null },
    acceptance: { metric: 'rage_rate', direction: 'down', minVisits: 200 },
    measured: null,
    dismissReason: null,
    issueId: 'iss-1',
    rank: 1,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    ...over,
  };
}
