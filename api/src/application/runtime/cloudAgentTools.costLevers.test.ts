/** C5: the repo-map tools reach a cloud run only when the lever is on for the tenant. */
import { describe, expect, it } from 'vitest';
import { CLOUD_SURFACE_CAPS, cloudAgentToolsFor, cloudSurfaceCapsFor } from './cloudAgentTools';
import { prepSurfaceCaps } from './cloudAgent/runSurfaceCaps';
import { ROLE_CORE_TOOLS } from './costLoop/deferredTools';

const names = (caps: ReadonlySet<string>) => cloudAgentToolsFor(caps as never).map((t) => t.function.name);
const ON = { COST_LEVER_C5_CLOUD_REPO_MAP: 'on' };
const OFF = { COST_LEVER_C5_CLOUD_REPO_MAP: 'off' };

describe('cost-lever capabilities on a cloud run', () => {
  it('lever off ⇒ the constant set, byte for byte', () => {
    expect(cloudSurfaceCapsFor(OFF, 7)).toBe(CLOUD_SURFACE_CAPS);
    expect(names(cloudSurfaceCapsFor(OFF, 7))).not.toContain('repo_map');
  });

  it('lever on ⇒ repo.semantic, which advertises repo_map and semantic_search with or without a sandbox', () => {
    for (const caps of [cloudSurfaceCapsFor(ON, 7), prepSurfaceCaps(ON, 7, true)]) {
      expect(caps.has('repo.semantic')).toBe(true);
      expect(names(caps)).toEqual(expect.arrayContaining(['repo_map', 'semantic_search']));
    }
  });

  it('repo_map is a core tool for exploring and coding roles', () => {
    expect(ROLE_CORE_TOOLS.explore).toContain('repo_map');
    expect(ROLE_CORE_TOOLS.code).toContain('repo_map');
  });
});
