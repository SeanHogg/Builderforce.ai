/**
 * Test-only: the agent's ONE selector as the Brain calls it - with the Brain's own ranker (`relevantTools`) as `rank` and the required tools
 * held to the cap (`run/brainPlatformTools.ts`). `selectTools.test.ts` and `selectTools.pins.test.ts` (the Brain's own, restored) run over
 * it, so they prove the ranker and the selection around it end to end; `packages/agent-run/test/tools` runs the same selector with the
 * shared scorer the cloud and the canvas keep.
 */

import { DEFAULT_TOOL_LIMIT, PINNED_OVERFLOW, selectToolsForTurn as agentSelect, type SelectToolsOptions } from '@builderforce/agent-run';
import type { BrainToolSpec } from './streamChatCompletion';
import { relevantTools } from './selectTools';

export { DEFAULT_TOOL_LIMIT, PINNED_OVERFLOW };
export const selectToolsForTurn = (tools: BrainToolSpec[] | undefined, o: { query: string; limit?: number; pinned?: Iterable<string>; required?: Iterable<string> }) =>
  agentSelect(tools, { ...o, pinned: [...(o.pinned ?? [])], required: [...(o.required ?? [])], rank: relevantTools, capRequired: true } satisfies SelectToolsOptions<BrainToolSpec>);
