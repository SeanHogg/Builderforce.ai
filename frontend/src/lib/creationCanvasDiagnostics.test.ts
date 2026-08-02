import { describe, expect, it } from 'vitest';
import { buildCreationCanvasDiagnosticsReport } from './creationCanvasDiagnostics';

describe('Creation Canvas diagnostics', () => {
  it('captures session, graph, Brain, and bounded conversation state', () => {
    const report = buildCreationCanvasDiagnosticsReport({
      sessionId: 'session-1', title: 'Campaign', persistence: 'server', role: 'owner', revision: 7,
      realtimeState: 'online', objectCount: 3, connectionCount: 2, objectKinds: { workflow: 1, website: 1, chat: 1 },
      selectedObjectIds: ['website-1'], hiddenObjectCount: 0, lockedObjectCount: 1, redactedObjectCount: 0,
      canonicalResourceCount: 2, memberCount: 3, pendingInvitationCount: 1,
      timeline: [{ role: 'user', body: 'Evaluate the campaign', createdAt: '2026-08-02T12:00:00.000Z' }],
      brain: { scope: 'canvas', thinking: false, proposedChangeCount: 2, actionCount: 3 },
    }, { uiVersion: 'ui-1', apiVersion: 'api-1', capturedAt: '2026-08-02T12:01:00.000Z', sourceUrl: 'https://builderforce.ai/create/session-1' });

    expect(report).toContain('# Creation Canvas diagnostics — Campaign');
    expect(report).toContain('revision: 7');
    expect(report).toContain('objectKinds: chat:1, website:1, workflow:1');
    expect(report).toContain('proposedChangesAwaitingReview: 2');
    expect(report).toContain('Evaluate the campaign');
  });
});
