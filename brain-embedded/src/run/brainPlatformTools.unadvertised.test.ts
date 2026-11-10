/**
 * A tool only the system prompt names is not advertised on a code turn (`brainPlatformTools.ts` `promptOnlyNamed`), and a DIRECT call
 * to it still runs: the Brain's catalog is closed, so the kernel hands every name to the surface (`agent-run` `runCatalog.ts`
 * `ownsCall`, `kernelHooks.ts` preflight, `runTurn.ts` `dispatchCall` -> `platform.execute`), and nothing on that path checks the menu.
 * The call is traced as routed, as a `builtin_tools_invoke` call to it would be. Runs the real `startRun` (area R harness).
 */
import { describe, expect, it } from 'vitest';
import { calls, runOn, say, spec, stepsLabelled, type Scenario } from './areaR/harness';

const LINK = 'builtin_chats_link_ticket';
const TOOLS = [spec('read_file'), spec('edit_file'), spec('run_command'), spec(LINK, 'link a ticket to a chat'), ...Array.from({ length: 40 }, (_, i) => spec(`builtin_platform_${i}`, `platform operation ${i}`))];

describe('a direct call to a tool the code turn did not advertise', () => {
  it('is not on the menu, still dispatches to the host, and is traced as routed', async () => {
    const s: Scenario = {
      key: 9401,
      script: () => [calls({ name: LINK, args: { chatId: 1, taskId: 2 } }), say('Done.')],
      // A quick run starts in `code` (`pipelineRoute.ts`); the system prompt names the link tool, the request does not.
      request: () => ({ tools: TOOLS, resolvedSystemPrompt: `You are the Brain. Link work with ${LINK}.`, pipeline: { routing: 'auto' }, userTurn: 'fix the typo in a.ts' }),
    };
    const run = await runOn(s);
    expect(run.wire[0]!.tools).not.toContain(LINK);
    expect(run.toolCalls).toEqual([{ name: LINK, args: { chatId: 1, taskId: 2 } }]);
    const routed = stepsLabelled(run, 'tools.routed');
    expect(routed).toHaveLength(1);
    expect(routed[0]!.args).toMatchObject({ step: 0, via: 'direct' });
  });

  it('a call to a tool the turn advertised is not traced as routed', async () => {
    const s: Scenario = {
      key: 9402,
      script: () => [calls({ name: 'read_file', args: { path: 'a.ts' } }), say('Done.')],
      request: () => ({ tools: TOOLS, pipeline: { routing: 'auto' }, userTurn: 'fix the typo in a.ts' }),
    };
    const run = await runOn(s);
    expect(run.wire[0]!.tools).toContain('read_file');
    expect(stepsLabelled(run, 'tools.routed')).toHaveLength(0);
  });
});
