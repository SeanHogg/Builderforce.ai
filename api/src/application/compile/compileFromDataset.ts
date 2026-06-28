/**
 * `compile('dataset')` — lowers a trained/published Workforce agent (identity + a
 * `builderforce/workforce-<id>` model ref) plus the grounded context recalled from
 * its ingested proprietary docs (Phase C3) into the spec's identity, model, and
 * `memory.recalledContext`. This is the "train on our data, answer support calls"
 * path expressed as a compile adapter. Pure — recall happens upstream (the route
 * calls `recallAgentKnowledge`) and is passed in.
 */
import type { AgentSpec } from '@builderforce/agent-tools';
import type { DatasetNeed } from './types';

export function compileFromDataset(need: DatasetNeed): AgentSpec {
  const recalled = need.recalledContext?.trim();
  return {
    identity: {
      name: need.identity.name,
      title: need.identity.title,
      bio: need.identity.bio,
      skills: need.identity.skills,
    },
    ...(need.modelRef !== undefined ? { model: { ref: need.modelRef } } : {}),
    ...(recalled ? { memory: { recalledContext: recalled } } : {}),
  };
}
