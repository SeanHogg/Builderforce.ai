import { describe, it, expect } from 'vitest';
import { CLOUD_AGENT_TOOLS, CONTAINER_AGENT_TOOLS } from './cloudAgentTools';

/**
 * Cloud human-in-the-loop wiring (migration 0120). These guard the contract that
 * lets a blocked cloud agent bubble a question up to a human instead of failing
 * silently — without re-running the whole gateway loop.
 */
describe('ask_human cloud tool', () => {
  const byName = (
    tools: readonly { function: { name: string; description: string; parameters: unknown } }[],
    name: string,
  ) => tools.find((t) => t.function.name === name);

  it('is offered to the durable/Worker cloud loop with a required question param', () => {
    const tool = byName(CLOUD_AGENT_TOOLS, 'ask_human');
    expect(tool).toBeDefined();
    const params = tool!.function.parameters as { required?: string[]; properties?: Record<string, unknown> };
    expect(params.required).toContain('question');
    expect(params.properties).toHaveProperty('question');
    // Optional context so the human can answer well, but it must not be required.
    expect(params.required).not.toContain('context');
  });

  it('steers the model away from a silent give-up (finish description points to ask_human)', () => {
    const finish = byName(CLOUD_AGENT_TOOLS, 'finish');
    expect(finish!.function.description.toLowerCase()).toContain('ask_human');
  });

  it('is ALSO offered to the container / GitHub Actions surface, which now honours it', () => {
    // Both images drive their whole loop in one process, so their pause is
    // exit-and-redispatch: they post the `ask_human` container-op with their
    // conversation, exit WITHOUT a terminal op, and are restarted with the answer.
    // See containerPauseContract.test.ts for the image side of that contract.
    const tool = byName(CONTAINER_AGENT_TOOLS, 'ask_human');
    expect(tool).toBeDefined();
    const params = tool!.function.parameters as { required?: string[] };
    expect(params.required).toContain('question');
  });
});
