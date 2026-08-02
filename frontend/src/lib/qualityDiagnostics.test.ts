import { describe, expect, it } from 'vitest';
import type { ErrorGroup } from './builderforceApi';
import { buildQualityDiagnosticsReport } from './qualityDiagnostics';

const group: ErrorGroup = {
  id: 'group-1', projectId: 12, collectorId: null, fingerprint: 'resize-loop',
  title: 'ResizeObserver loop completed with undelivered notifications.', type: 'Error',
  level: 'error', status: 'unresolved', eventCount: 61, userCount: 0,
  firstSeen: '2026-08-01T10:00:00.000Z', lastSeen: '2026-08-02T10:00:00.000Z',
  environment: 'production', release: '2026.8.1', taskId: null,
};

describe('Quality diagnostics', () => {
  it('exports every matching error and explains collector-less groups', () => {
    const report = buildQualityDiagnosticsReport(
      { projectId: 12, status: null, level: 'error', groups: [group], stats: null, statsError: 'offline' },
      { capturedAt: '2026-08-02T12:00:00.000Z', uiVersion: '2026.8.1', apiVersion: '2026.8.2' },
    );

    expect(report).toContain('# Product Quality diagnostics');
    expect(report).toContain('levelFilter: error');
    expect(report).toContain('errorGroups: 1');
    expect(report).toContain('groupsWithoutCollector: 1');
    expect(report).toContain('in-app/internal Builderforce reporter, or its collector was later deleted');
    expect(report).toContain(group.title);
    expect(report).toContain('"fingerprint": "resize-loop"');
    expect(report).toContain('overviewUnavailable: offline');
  });
});
