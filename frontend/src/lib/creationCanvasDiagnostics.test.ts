import { describe, expect, it } from 'vitest';
import { buildCreationCanvasDiagnosticsReport, type CreationCanvasDiagnosticsInput } from './creationCanvasDiagnostics';

const CONTEXT = { uiVersion: 'ui-1', apiVersion: 'api-1', capturedAt: '2026-08-02T12:01:00.000Z', sourceUrl: 'https://builderforce.ai/create/session-1' };

function input(overrides: Partial<CreationCanvasDiagnosticsInput> = {}): CreationCanvasDiagnosticsInput {
  return {
    sessionId: 'session-1', title: 'Campaign', persistence: 'server', role: 'owner', revision: 7,
    realtimeState: 'online', connectionCount: 2,
    objects: [
      { id: 'chat-1', data: { kind: 'chat', title: 'Brain' } },
      { id: 'website-1', data: { kind: 'website', title: 'Site', status: 'Draft' } },
      { id: 'workflow-1', data: { kind: 'workflow', title: 'Send SMS', status: 'Complete' } },
    ],
    selectedObjectIds: ['website-1'], hiddenObjectCount: 0, lockedObjectCount: 1, redactedObjectCount: 0,
    canonicalResourceCount: 2, memberCount: 3, pendingInvitationCount: 1,
    timeline: [{ role: 'user', body: 'Evaluate the campaign', createdAt: '2026-08-02T12:00:00.000Z' }],
    brain: { scope: 'canvas', thinking: false, proposedChangeCount: 2, actionCount: 3 },
    ...overrides,
  };
}

describe('Creation Canvas diagnostics', () => {
  it('captures session, graph, Brain, and bounded conversation state', () => {
    const report = buildCreationCanvasDiagnosticsReport(input(), CONTEXT);

    expect(report).toContain('# Creation Canvas diagnostics — Campaign');
    expect(report).toContain('revision: 7');
    expect(report).toContain('objectKinds: chat:1, website:1, workflow:1');
    expect(report).toContain('proposedChangesAwaitingReview: 2');
    expect(report).toContain('Evaluate the campaign');
  });

  // The regression this report exists to catch. A workflow card can say
  // "Complete" while having no steps and no linked definition; the report must
  // contradict the card rather than agree with it.
  it('reports a workflow that cannot run, however its status chip reads', () => {
    const report = buildCreationCanvasDiagnosticsReport(input(), CONTEXT);

    expect(report).toContain('-- Canvas objects --');
    expect(report).toContain('workflow-1 · workflow · "Send SMS" · status=Complete');
    expect(report).toContain('authoredSteps: 0');
    expect(report).toContain('runnable: no (definition not linked)');
  });

  it('names the call each authored step makes, and reports a linked definition as runnable', () => {
    const report = buildCreationCanvasDiagnosticsReport(input({
      objects: [{
        id: 'workflow-1',
        data: {
          kind: 'workflow', title: 'Send SMS', status: 'Built',
          resourceId: 'workflow:def-9', workflowExecutable: true,
          steps: [
            { title: 'Text the customer', connector: 'twilio', action: 'send_sms' },
            { title: 'Follow up' },
          ],
        },
      }],
    }), CONTEXT);

    expect(report).toContain('runnable: yes (definition def-9)');
    expect(report).toContain('1. Text the customer → twilio.send_sms');
    // An underspecified step is named as such rather than rendered as configured.
    expect(report).toContain('2. Follow up → (no action)');
  });

  // Two `workflow-run · delivered` rows described a workflow that never ran,
  // because the provider that wrote them was the browser. Provider is reported.
  it('attributes every delivered output to the provider that produced it', () => {
    const report = buildCreationCanvasDiagnosticsReport(input({
      objects: [{
        id: 'workflow-1',
        data: {
          kind: 'workflow', title: 'Send SMS',
          deliverables: [
            { artifactKind: 'workflow-run', status: 'delivered', provider: 'browser-draft', createdAt: '2026-08-02T11:55:00.000Z', validation: { status: 'passed' } },
          ],
        },
      }],
    }), CONTEXT);

    expect(report).toContain('-- Delivered outputs (provider-attributed) --');
    expect(report).toContain('workflow-run · delivered');
    expect(report).toContain('provider=browser-draft');
  });

  it('includes the Brain tool trace and announces any elision', () => {
    const trace = Array.from({ length: 40 }, (_, i) => ({
      ts: `2026-08-02T12:00:${String(i).padStart(2, '0')}.000Z`,
      category: 'tool', label: `canvas_call_${i}`, ok: i === 39 ? false : null,
    }));
    const report = buildCreationCanvasDiagnosticsReport(input({ trace }), CONTEXT);

    expect(report).toContain('traceEvents: 40');
    expect(report).toContain('tool/canvas_call_0');
    expect(report).toContain('tool/canvas_call_39 FAILED');
    expect(report).toContain('earlier trace events elided');
  });

  it('reports unsaved work rather than leaving it indistinguishable from saved', () => {
    const report = buildCreationCanvasDiagnosticsReport(input({ unsavedChanges: true, saveInFlight: false, undoDepth: 4 }), CONTEXT);

    expect(report).toContain('unsavedChanges: yes');
    expect(report).toContain('saveInFlight: no');
    expect(report).toContain('undoDepth: 4');
  });

  it('survives a trace or object payload that cannot be summarized', () => {
    expect(() => buildCreationCanvasDiagnosticsReport(input({
      objects: [{ id: 'x', data: { kind: 'workflow', title: 'X', steps: [null, 'bare string step', 42] } }],
    }), CONTEXT)).not.toThrow();
  });
});
