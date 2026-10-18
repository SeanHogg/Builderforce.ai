/** RFP persona steering for a built-in agent (the lookup itself is `agent/builtinAgentRef`). */
import type { BuiltinAgentRef } from '../agent/builtinAgentRef';

/** Compose a persona directive from a built-in agent's bio + skills, for steering an
 *  `ideProxy` analysis call "as" that agent (mirrors businessValueAI's personaDirective). */
export function personaDirectiveFor(agent: BuiltinAgentRef | null): string | null {
  if (!agent) return null;
  const skills = agent.skills.length ? ` Skills: ${agent.skills.join(', ')}.` : '';
  return `${agent.name}${agent.bio ? ` — ${agent.bio}` : ''}${skills}`;
}
