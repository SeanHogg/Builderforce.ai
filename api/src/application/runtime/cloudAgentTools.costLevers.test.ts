/** C5: the repo-map tools reach a cloud surface only when the lever is on for the tenant. */
import { describe, expect, it } from 'vitest';
import { REPO_INDEX_TOOL_NAMES } from '../../../container/repoIndex.mjs';
import {
  CONTAINER_AGENT_TOOLS, CLOUD_SURFACE_CAPS, CONTAINER_SURFACE_CAPS, cloudAgentToolsFor, cloudSurfaceCapsFor, containerSurfaceCapsFor,
} from './cloudAgentTools';
import { ROLE_CORE_TOOLS } from './costLoop/deferredTools';

const names = (caps: ReadonlySet<string>) => cloudAgentToolsFor(caps as never).map((t) => t.function.name);
const ON = { COST_LEVER_C5_CLOUD_REPO_MAP: 'on' };
const OFF = { COST_LEVER_C5_CLOUD_REPO_MAP: 'off' };

describe('cost-lever capabilities on the cloud surfaces', () => {
  it('lever off ⇒ the constant sets, byte for byte', () => {
    expect(cloudSurfaceCapsFor(OFF, 7)).toBe(CLOUD_SURFACE_CAPS);
    expect(containerSurfaceCapsFor(OFF, 7)).toBe(CONTAINER_SURFACE_CAPS);
    expect(names(cloudSurfaceCapsFor(OFF, 7))).not.toContain('repo_map');
  });

  it('lever on ⇒ repo.semantic, which advertises repo_map and semantic_search on both surfaces', () => {
    for (const caps of [cloudSurfaceCapsFor(ON, 7), containerSurfaceCapsFor(ON, 7)]) {
      expect(caps.has('repo.semantic')).toBe(true);
      expect(names(caps)).toEqual(expect.arrayContaining(['repo_map', 'semantic_search']));
    }
  });

  it('every tool the lever adds to the container is one the image dispatches (repoIndex.mjs)', () => {
    const base = new Set(CONTAINER_AGENT_TOOLS.map((t) => t.function.name));
    const added = names(containerSurfaceCapsFor(ON, 7)).filter((n) => !base.has(n));
    expect(added.length).toBeGreaterThan(0);
    for (const name of added) expect(REPO_INDEX_TOOL_NAMES).toContain(name);
  });

  it('repo_map is a core tool for exploring and coding roles', () => {
    expect(ROLE_CORE_TOOLS.explore).toContain('repo_map');
    expect(ROLE_CORE_TOOLS.code).toContain('repo_map');
  });
});
