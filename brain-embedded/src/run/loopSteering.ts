/**
 * The agent's STEERING port over a Brain run (PRD 35 §4 WS4): the direction that arrived while the run was working goes in
 * front of the next turn, recorded as one `steer.applied` step and saved as it is read - the SAME `takeRunSteering` and
 * `persistSteer` the Brain's loop runs. The interrupt side (a step in flight) is the run-keyed queue the agent owns.
 */

import { runSteeringSource, type SteerInput, type SteeringSource } from '@builderforce/agent-run';
import { hasRunInterrupt, steerModelContent } from '../runSteering';
import type { RunLoopContext } from '../runStore/runLoopContext';
import { takeRunSteering } from '../runStore/steerInterrupt';
import { persistSteer } from '../runStore/steerPersistence';

export function loopSteeringSource(run: RunLoopContext, turn: () => number): SteeringSource {
  const { c, chatId, runKey, req } = run;
  return {
    ...runSteeringSource(runKey),
    async drain(): Promise<SteerInput[]> {
      const out: SteerInput[] = [];
      const interrupt = hasRunInterrupt(runKey);
      for (const steer of takeRunSteering(c, runKey, turn())) {
        await persistSteer(c, chatId, req.persistence, steer, runKey);
        const content = steerModelContent(steer);
        out.push({ text: typeof content === 'string' ? content : content.map((p) => ('text' in p && typeof p.text === 'string' ? p.text : '')).join(''), ...(interrupt ? { interrupt: true } : {}) });
      }
      return out;
    },
  };
}
