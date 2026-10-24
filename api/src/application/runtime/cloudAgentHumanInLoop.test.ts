import { describe, it, expect } from 'vitest';
import { CLOUD_AGENT_TOOLS, cloudAgentToolsFor } from './cloudAgentTools';
import { prepSurfaceCaps } from './cloudAgent/runSurfaceCaps';

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

  it("is offered to a sandboxed run too — the pause is the engine's, whatever serves the shell", () => {
    // Every cloud run is the one engine on its durable runner: a question parks the
    // runner's cursor, and the sandbox (container or Actions runner) only serves tools.
    const tool = byName(cloudAgentToolsFor(prepSurfaceCaps({}, 1, true)), 'ask_human');
    expect(tool).toBeDefined();
    const params = tool!.function.parameters as { required?: string[] };
    expect(params.required).toContain('question');
  });
});
