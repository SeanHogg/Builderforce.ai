/**
 * The agent's STEERING port over a Brain run (PRD 35 §4 WS4): the direction that arrived while the run was working goes in
 * front of the next turn, recorded as one `steer.applied` step and saved as it is read - the SAME `takeRunSteering` and
 * `persistSteer` the Brain's loop runs. The interrupt side (a step in flight) is the run-keyed queue the agent owns.
 */

import { runSteeringSource, type SteerInput, type SteeringSource } from '@builderforce/agent-run';
import { imagePartsOf } from './runMessages';
import { hasRunInterrupt, steerModelContent } from '../runSteering';
import type { RunLoopContext } from '../runStore/runLoopContext';
import { takeRunSteering } from '../runStore/steerInterrupt';
import { persistSteer } from '../runStore/steerPersistence';

/**
 * Which steered words are the PERSON's own. The agent turns a drained steer into a user row it writes itself, so the store
 * (`loopStore.ts`) asks here whether that row is one of the chat's asks (`chatAsks.ts`): a child's report or an owner's
 * direction, which arrive the same way, are not.
 */
export interface PersonSteers {
  note(text: string): void;
  take(text: string): boolean;
}

export function personSteers(): PersonSteers {
  const waiting: string[] = [];
  return {
    note: (text) => void waiting.push(text),
    take(text) {
      const at = waiting.indexOf(text);
      if (at < 0) return false;
      waiting.splice(at, 1);
      return true;
    },
  };
}

export function loopSteeringSource(run: RunLoopContext, people: PersonSteers): SteeringSource {
  const { c, chatId, runKey, req } = run;
  return {
    ...runSteeringSource(runKey),
    async drain(env): Promise<SteerInput[]> {
      const out: SteerInput[] = [];
      const interrupt = hasRunInterrupt(runKey);
      // Recorded as ONE `steer.applied` step at the kernel's step: the one the next model call (or the answer just given) belongs to.
      for (const steer of takeRunSteering(c, runKey, env?.step ?? 0)) {
        await persistSteer(c, chatId, req.persistence, steer, runKey);
        const content = steerModelContent(steer);
        const parts = imagePartsOf(content);
        const text = typeof content === 'string' ? content : content.map((p) => ('text' in p && typeof p.text === 'string' ? p.text : '')).join('');
        if (steer.fromPerson) people.note(text);
        out.push({
          text,
          ...(parts.length > 0 ? { parts } : {}),
          ...(interrupt ? { interrupt: true } : {}),
        });
      }
      return out;
    },
  };
}
