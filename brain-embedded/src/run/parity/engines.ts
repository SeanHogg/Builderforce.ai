/**
 * The engines the suites run. Deleting `runLoop.ts` and the engine switch removes `'loop'` here and nothing else: the
 * differential suite then has one side and goes with it, and the snapshot suite compares the agent to what the loop did.
 */
import type { RunEngineId } from '../../runStore/runTypes';

export const ENGINES: readonly RunEngineId[] = ['loop', 'agent'];
