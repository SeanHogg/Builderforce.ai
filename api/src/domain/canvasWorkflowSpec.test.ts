import { describe, expect, it } from 'vitest';
import { compileCanvasWorkflowSteps, connectorActionIndex } from './canvasWorkflowSpec';
import { compileDefinition, validateDefinition } from './workflowGraph';

const CATALOG = connectorActionIndex([
  { key: 'twilio', actions: [{ key: 'send_sms' }, { key: 'send_whatsapp' }, { key: 'make_call' }] },
  { key: 'sendgrid', actions: [{ key: 'send_email' }] },
]);

describe('compileCanvasWorkflowSteps', () => {
  it('lowers authored integration steps into a runnable connector chain', () => {
    const { definition, issues, compiledCount } = compileCanvasWorkflowSteps([
      { title: 'Text the customer', connector: 'twilio', action: 'send_sms', input: { To: '+15550001111', From: '+15550002222', Body: 'Hi' } },
      { title: 'Email the receipt', connector: 'sendgrid', action: 'send_email' },
    ], { catalog: CATALOG });

    expect(issues).toEqual([]);
    expect(compiledCount).toBe(2);
    // A synthesized manual trigger plus the two authored steps, wired in order.
    expect(definition.nodes.map((n) => n.kind)).toEqual(['trigger', 'connector', 'connector']);
    expect(definition.edges).toHaveLength(2);
    expect(validateDefinition(definition)).toBeNull();

    const [, sms] = definition.nodes;
    expect(sms!.config).toMatchObject({ connector: 'twilio', action: 'send_sms', input: { Body: 'Hi' } });
  });

  it('compiles to steps the orchestrator can execute, with dependencies in order', () => {
    const { definition } = compileCanvasWorkflowSteps([
      { title: 'Send', connector: 'twilio', action: 'send_sms' },
    ], { catalog: CATALOG });

    const steps = compileDefinition(definition);
    expect(steps.map((s) => s.role)).toEqual(['node:trigger', 'node:connector']);
    expect(steps[1]!.dependsOnNodeIds).toEqual(['trigger']);
    expect(steps[1]!.description).toBe('twilio → send_sms');
  });

  // The whole point: a step that only has a name is an intention, and compiling
  // it into something that runs green would recreate the failure this replaced.
  it('refuses a title-only step instead of inventing an action for it', () => {
    const { definition, issues } = compileCanvasWorkflowSteps([
      { title: 'Audience' }, { title: 'Approve' },
    ], { catalog: CATALOG });

    expect(definition.nodes.filter((n) => n.kind !== 'trigger')).toHaveLength(0);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ step: 1, title: 'Audience' });
    expect(issues[0]!.message).toContain('no action to run');
  });

  it('rejects an unknown connector and names what is available', () => {
    const { issues } = compileCanvasWorkflowSteps([
      { title: 'Send', connector: 'twilioo', action: 'send_sms' },
    ], { catalog: CATALOG });

    expect(issues[0]!.message).toContain('No connected integration named "twilioo"');
    expect(issues[0]!.message).toContain('sendgrid, twilio');
  });

  it('rejects an unknown action on a real connector and lists the real ones', () => {
    const { issues } = compileCanvasWorkflowSteps([
      { title: 'Send', connector: 'twilio', action: 'send_text' },
    ], { catalog: CATALOG });

    expect(issues[0]!.message).toContain('"twilio" has no action "send_text"');
    expect(issues[0]!.message).toContain('send_sms');
  });

  it('accepts actionKey as well as action, since both names exist in the runtime', () => {
    const { issues, definition } = compileCanvasWorkflowSteps([
      { title: 'Send', connector: 'twilio', actionKey: 'send_sms' },
    ], { catalog: CATALOG });

    expect(issues).toEqual([]);
    expect(definition.nodes[1]!.config).toMatchObject({ action: 'send_sms' });
  });

  it('infers llm and agent steps, and requires a prompt for a model step', () => {
    const ok = compileCanvasWorkflowSteps([
      { title: 'Draft the copy', prompt: 'Write a 2-line SMS' },
      { title: 'Review', role: 'code-reviewer', task: 'Check tone' },
    ], { catalog: CATALOG });
    expect(ok.issues).toEqual([]);
    expect(ok.definition.nodes.map((n) => n.kind)).toEqual(['trigger', 'llm', 'agent']);

    const bad = compileCanvasWorkflowSteps([{ title: 'Draft', model: 'gpt-4o' }], { catalog: CATALOG });
    expect(bad.issues[0]!.message).toContain('needs a prompt');
  });

  it('keeps an authored trigger instead of prefixing a second one', () => {
    const { definition } = compileCanvasWorkflowSteps([
      { title: 'On inbound SMS', kind: 'trigger', triggerType: 'webhook' },
      { title: 'Reply', connector: 'twilio', action: 'send_sms' },
    ], { catalog: CATALOG });

    expect(definition.nodes.filter((n) => n.kind === 'trigger')).toHaveLength(1);
    expect(definition.nodes[0]!.config).toMatchObject({ triggerType: 'webhook' });
    expect(validateDefinition(definition)).toBeNull();
  });

  it('reports an empty step list rather than emitting an empty graph', () => {
    const { definition, issues } = compileCanvasWorkflowSteps([], { catalog: CATALOG });
    expect(definition.nodes).toEqual([]);
    expect(issues[0]!.message).toContain('no steps to compile');
  });

  it('tolerates malformed authored steps without throwing', () => {
    expect(() => compileCanvasWorkflowSteps([null, 42, 'bare title', { connector: 'twilio' }], { catalog: CATALOG })).not.toThrow();
    const { issues } = compileCanvasWorkflowSteps([{ connector: 'twilio' }], { catalog: CATALOG });
    expect(issues[0]!.message).toContain('needs an action on "twilio"');
  });
});
