/**
 * Opening a legacy authored step list on the board.
 *
 * The invariant under test is the MIGRATION one: everything the deleted server
 * compiler (`canvasWorkflowSpec.ts`) could turn into a runnable node, this turns
 * into a step object carrying the same config — because that config is what the
 * one remaining compiler (`compileBoardFlow`) lowers. If the two disagree, a
 * workflow that ran before opening stops running after it, which is the only way
 * this change could lose somebody's work.
 */
import { describe, expect, it } from 'vitest';
import { canvasStepsToDefinition, flowStepsFromCanvasSteps } from './flowStepsFromCanvasSteps';
import { compileBoardFlow } from './compileBoardFlow';

const options = { untitledStep: (position: number) => `Step ${position}` };
const nodeById = (definition: ReturnType<typeof canvasStepsToDefinition>, id: string) =>
  definition.nodes.find((node) => node.id === id);

describe('canvasStepsToDefinition', () => {
  it('draws a manual trigger in front of a list that has none', () => {
    const definition = canvasStepsToDefinition([{ prompt: 'Summarise it' }], options);
    expect(definition.nodes[0]?.kind).toBe('trigger');
    expect(definition.nodes[0]?.config).toEqual({ triggerType: 'manual' });
    expect(definition.edges).toHaveLength(1);
  });

  it('keeps an authored trigger instead of adding a second one', () => {
    const definition = canvasStepsToDefinition(
      [{ title: 'Weekday cadence', kind: 'trigger', triggerType: 'schedule', cron: '0 9 * * 1-5', timezone: 'America/New_York' }],
      options,
    );
    expect(definition.nodes.filter((node) => node.kind === 'trigger')).toHaveLength(1);
    expect(definition.nodes[0]?.config).toEqual({ triggerType: 'schedule', cron: '0 9 * * 1-5', timezone: 'America/New_York' });
  });

  it('infers the step from the fields it carries', () => {
    const definition = canvasStepsToDefinition([
      { title: 'Send the SMS', connector: 'twilio', action: 'send_sms', input: { to: '+1' } },
      { title: 'Summarise', prompt: 'Summarise the reply' },
      { title: 'Draft it', role: 'campaign-strategist', task: 'Write the follow-up' },
      { title: 'Only paid', condition: 'order.paid' },
      { title: 'Reshape', expression: '{ id: input.id }' },
    ], options);
    expect(definition.nodes.map((node) => node.kind)).toEqual(['trigger', 'connector', 'llm', 'agent', 'filter', 'transform']);
    expect(nodeById(definition, 's1')?.config).toMatchObject({ connector: 'twilio', action: 'send_sms', input: { to: '+1' } });
    expect(nodeById(definition, 's2')?.config).toMatchObject({ provider: 'openai', prompt: 'Summarise the reply' });
  });

  it('lets an explicit catalog kind win over inference', () => {
    const definition = canvasStepsToDefinition([{ title: 'Route it', kind: 'switch', condition: 'order.paid' }], options);
    expect(nodeById(definition, 's1')?.kind).toBe('switch');
  });

  it('labels the edge leaving a branch so the executor prunes the arm not taken', () => {
    const definition = canvasStepsToDefinition([
      { title: 'Paid?', kind: 'branch', condition: 'order.paid' },
      { title: 'Charge', connector: 'stripe', action: 'charge' },
    ], options);
    expect(definition.edges.find((edge) => edge.source === 's1')?.label).toBe('true');
    // The unconditional edge in front of the branch carries no label: an outlet to
    // prune on for a node that publishes none would delete a live path.
    expect(definition.edges.find((edge) => edge.source === 'trigger')?.label).toBeUndefined();
  });

  it('keeps an intention that names no action, as a step that needs setting up', () => {
    // The deleted compiler REFUSED this. A board can hold it, and the build says
    // what it needs — losing it would strand the author's intention in JSON.
    const definition = canvasStepsToDefinition([{ title: 'Email the customer' }], options);
    expect(nodeById(definition, 's1')).toMatchObject({ kind: 'agent', label: 'Email the customer', config: { task: '' } });
  });

  it('names an untitled step through the caller, so it arrives in their language', () => {
    const definition = canvasStepsToDefinition([{ prompt: 'x' }], { untitledStep: (position) => `Étape ${position}` });
    expect(nodeById(definition, 's1')?.label).toBe('Étape 1');
  });

  it('reads a bare string step and ignores a list that is not one', () => {
    expect(canvasStepsToDefinition(['Do the thing'], options).nodes[1]?.label).toBe('Do the thing');
    expect(canvasStepsToDefinition(undefined, options)).toEqual({ nodes: [], edges: [] });
    expect(canvasStepsToDefinition({ not: 'a list' }, options)).toEqual({ nodes: [], edges: [] });
  });
});

describe('flowStepsFromCanvasSteps', () => {
  it('unpacks the list into step objects inside a frame at the card position', () => {
    const unpacked = flowStepsFromCanvasSteps(
      [{ title: 'Send the SMS', connector: 'twilio', action: 'send_sms' }],
      { x: 200, y: 100 },
      options,
    );
    expect(unpacked.steps.map((step) => step.data.stepKind)).toEqual(['trigger', 'connector']);
    expect(unpacked.steps[0]?.position).toEqual({ x: 200, y: 100 });
    expect(unpacked.frame.position.x).toBeLessThan(200);
    expect(unpacked.connections).toHaveLength(1);
  });

  it('reattaches a branch arm to the outlet its label names', () => {
    const unpacked = flowStepsFromCanvasSteps([
      { title: 'Paid?', kind: 'branch', condition: 'order.paid' },
      { title: 'Charge', connector: 'stripe', action: 'charge' },
    ], { x: 0, y: 0 }, options);
    const arm = unpacked.connections.find((connection) => connection.sourceRef === 's1');
    expect(arm?.label).toBe('true');
    expect(arm?.sourceHandle).toBeTruthy();
  });

  it('round-trips: what opened on the board compiles back to the same calls', () => {
    // The migration guarantee. The steps a legacy card held, unpacked and then
    // lowered by the ONE compiler, must still reach Twilio with the same action.
    const unpacked = flowStepsFromCanvasSteps([
      { title: 'Summarise', prompt: 'Summarise the reply' },
      { title: 'Send the SMS', connector: 'twilio', action: 'send_sms', input: { to: '+1' } },
    ], { x: 0, y: 0 }, options);
    const objects = unpacked.steps.map((step, index) => ({ id: `n${index}`, position: step.position, data: step.data }));
    const refToId = new Map(unpacked.steps.map((step, index) => [step.ref, `n${index}`]));
    const connections = unpacked.connections.map((connection, index) => ({
      id: `c${index}`,
      source: refToId.get(connection.sourceRef) ?? '',
      target: refToId.get(connection.targetRef) ?? '',
      sourceHandle: connection.sourceHandle,
    }));

    const { definition, issues } = compileBoardFlow(objects, connections);
    expect(issues).toEqual([]);
    const connector = definition.nodes.find((node) => node.kind === 'connector');
    expect(connector?.config).toMatchObject({ connector: 'twilio', action: 'send_sms' });
    expect(definition.nodes.some((node) => node.kind === 'llm')).toBe(true);
  });
});
