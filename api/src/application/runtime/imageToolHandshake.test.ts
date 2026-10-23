/**
 * The handshake is what replaced "a capability must follow the DEPLOYED image" with a
 * mechanism, so the failure it prevents is the thing worth testing: an image being
 * offered a tool it has no handler for, and — the mirror-image mistake — an image that
 * cannot speak the handshake losing tools it has always implemented.
 *
 * It also guards the ONE consolidation invariant that no type-checker can reach: the
 * container image, the Actions runner and this Worker must agree about which tool names
 * exist, and two of those three are shipped artifacts written in plain JavaScript.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolSchema } from '@builderforce/agent-tools';
import { HANDSHAKE_ONLY_TOOLS, imageAdvertisedTools, readToolManifest } from './imageToolHandshake';
import { CONTAINER_AGENT_TOOLS, cloudAgentToolsFor, containerSurfaceCapsFor } from './cloudAgentTools';

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, '../../..');
const relayModule = readFileSync(resolve(apiRoot, 'container/agentRelay.mjs'), 'utf8');
const containerServer = readFileSync(resolve(apiRoot, 'container/server.mjs'), 'utf8');
const repoIndexModule = readFileSync(resolve(apiRoot, 'container/repoIndex.mjs'), 'utf8');

const tool = (name: string): ToolSchema => ({
  type: 'function',
  function: { name, description: '', parameters: { type: 'object' } },
});
const names = (tools: readonly ToolSchema[]) => tools.map((t) => t.function.name);

describe('readToolManifest', () => {
  it('reads a list of names off the op payload', () => {
    expect(readToolManifest(['read_file', 'finish'])).toEqual(['read_file', 'finish']);
  });

  it('treats anything that is not a non-empty string list as ABSENT, not as empty', () => {
    // The distinction is the whole safety property: an empty manifest would mean "this
    // image implements nothing", and an image that cannot speak the handshake would
    // lose every tool rather than keeping the pre-handshake set.
    expect(readToolManifest(undefined)).toBeNull();
    expect(readToolManifest([])).toBeNull();
    expect(readToolManifest('read_file')).toBeNull();
    expect(readToolManifest([1, 2])).toBeNull();
  });
});

describe('imageAdvertisedTools', () => {
  it('offers an OLD image everything except the handshake-gated tools', () => {
    // An image predating the handshake sends nothing. It must keep the toolset it has
    // always implemented, and must NOT be offered anything added since.
    const got = names(imageAdvertisedTools([tool('read_file'), tool('spawn_agent')], null));
    expect(got).toEqual(['read_file']);
  });

  it('offers a CURRENT image exactly what it says it can dispatch', () => {
    const got = names(imageAdvertisedTools(
      [tool('read_file'), tool('spawn_agent'), tool('skill_propose')],
      ['read_file', 'spawn_agent'],
    ));
    expect(got).toEqual(['read_file', 'spawn_agent']);
  });

  it('never offers a tool the image did not name, even one the surface permits', () => {
    // This is the failure the whole mechanism exists to prevent: a tool advertised to a
    // process with no handler for it is a wasted step and a model told it can do
    // something it then cannot.
    expect(names(imageAdvertisedTools([tool('edit_file')], ['read_file']))).toEqual([]);
  });

  it('honours a trailing `*` as a prefix, so the platform catalog needs no redeploy', () => {
    const got = names(imageAdvertisedTools(
      [tool('builtin_tasks_create'), tool('builtin_okr_update'), tool('read_file')],
      ['builtin_*'],
    ));
    expect(got).toEqual(['builtin_tasks_create', 'builtin_okr_update']);
  });
});

describe('the images and the Worker agree about tool names', () => {
  /** The relay module is plain ESM in a separately shipped artifact, so its arrays can
   *  only be read as text from here. Anchored on the `export const` so a renamed
   *  constant fails loudly rather than silently matching nothing. */
  const arrayLiteral = (constName: string): string[] => {
    const match = new RegExp(`export const ${constName} = \\[([^\\]]*)\\]`).exec(relayModule);
    expect(match, `${constName} not found in container/agentRelay.mjs`).toBeTruthy();
    return [...(match?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  };
  /** The Container image's own tools beyond the shared image-local set (`edit_file` —
   *  the Actions runner has no handler for it), declared in `container/server.mjs`. */
  const containerLocal = (): string[] => {
    const match = /const CONTAINER_LOCAL_TOOL_NAMES = \[([^\]]*)\]/.exec(containerServer);
    expect(match, 'CONTAINER_LOCAL_TOOL_NAMES not found in container/server.mjs').toBeTruthy();
    return [...(match?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  };

  it('every tool the container surface advertises is one an image can dispatch', () => {
    // The core consolidation invariant. `CONTAINER_AGENT_TOOLS` is derived from the
    // capability set in TypeScript; the dispatch table is JavaScript in two shipped
    // images. Nothing but this test connects them.
    const relay = arrayLiteral('RELAY_TOOL_NAMES');
    const local = [...arrayLiteral('IMAGE_LOCAL_TOOL_NAMES'), ...containerLocal()];
    const dispatchable = [...relay, ...local];
    const covers = (name: string) =>
      dispatchable.some((entry) => (entry.endsWith('*') ? name.startsWith(entry.slice(0, -1)) : entry === name));
    for (const name of names(CONTAINER_AGENT_TOOLS)) {
      expect(covers(name), `${name} is advertised but no image dispatches it`).toBe(true);
    }
  });

  it('`spawn_agent` is relayed, not implemented in the image', () => {
    // The child runs in the Worker — an image has no gateway credential, no meter and
    // no registry — so a `spawn_agent` in the LOCAL list would mean a third copy of the
    // agent loop had been written into an image.
    expect(arrayLiteral('RELAY_TOOL_NAMES')).toContain('spawn_agent');
    expect(arrayLiteral('IMAGE_LOCAL_TOOL_NAMES')).not.toContain('spawn_agent');
  });

  it('the skill tools are relayed, not implemented in the image', () => {
    // A skill is written to the workspace's own store, which only the Worker can reach.
    expect(arrayLiteral('RELAY_TOOL_NAMES')).toEqual(expect.arrayContaining(['skill_propose', 'skill_list']));
    expect(arrayLiteral('IMAGE_LOCAL_TOOL_NAMES')).not.toContain('skill_propose');
  });

  it('a current Container is offered `edit_file`; an image too old to send a manifest is not', () => {
    const current = names(imageAdvertisedTools(CONTAINER_AGENT_TOOLS, [
      ...arrayLiteral('IMAGE_LOCAL_TOOL_NAMES'), ...arrayLiteral('RELAY_TOOL_NAMES'), ...containerLocal(),
    ]));
    expect(current).toContain('edit_file');
    expect(names(imageAdvertisedTools(CONTAINER_AGENT_TOOLS, null))).not.toContain('edit_file');
  });

  it('a current image is offered the skill tools; one too old to send a manifest is not', () => {
    const containerTools = names(CONTAINER_AGENT_TOOLS);
    expect(containerTools).toEqual(expect.arrayContaining(['skill_propose', 'skill_list']));
    const current = names(imageAdvertisedTools(CONTAINER_AGENT_TOOLS, [
      ...arrayLiteral('IMAGE_LOCAL_TOOL_NAMES'), ...arrayLiteral('RELAY_TOOL_NAMES'),
    ]));
    expect(current).toEqual(expect.arrayContaining(['skill_propose', 'skill_list']));
    const old = names(imageAdvertisedTools(CONTAINER_AGENT_TOOLS, null));
    expect(old).not.toContain('skill_propose');
    expect(old).not.toContain('skill_list');
  });

  /** The tools the Container names while its bf-context index is live (C5). */
  const repoIndexTools = (): string[] => {
    const match = /export const REPO_INDEX_TOOL_NAMES = \[([^\]]*)\]/.exec(repoIndexModule);
    expect(match, 'REPO_INDEX_TOOL_NAMES not found in container/repoIndex.mjs').toBeTruthy();
    return [...(match?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  };

  it('C5: with the lever on, a Container whose index is live is offered repo_map / semantic_search; one without it, or too old to send a manifest, is not', () => {
    const levered = cloudAgentToolsFor(containerSurfaceCapsFor({ COST_LEVER_C5_CLOUD_REPO_MAP: 'on' }, 1));
    expect(names(levered)).toEqual(expect.arrayContaining(['repo_map', 'semantic_search']));
    const base = [...arrayLiteral('IMAGE_LOCAL_TOOL_NAMES'), ...arrayLiteral('RELAY_TOOL_NAMES'), ...containerLocal()];
    expect(names(imageAdvertisedTools(levered, [...base, ...repoIndexTools()]))).toEqual(expect.arrayContaining(['repo_map', 'semantic_search']));
    expect(names(imageAdvertisedTools(levered, base))).not.toContain('repo_map');
    const old = names(imageAdvertisedTools(levered, null));
    expect(old).not.toContain('repo_map');
    expect(old).not.toContain('semantic_search');
    // Lever off: the surface's constant set, exactly as before.
    expect(names(cloudAgentToolsFor(containerSurfaceCapsFor({ COST_LEVERS_ALL: 'off' }, 1)))).not.toContain('repo_map');
  });

  it('everything gated behind the handshake is something a current image dispatches', () => {
    // A gated tool no image implements would be permanently invisible: withheld from an
    // old image by the gate, and from a new one by the intersection.
    const relay = arrayLiteral('RELAY_TOOL_NAMES');
    const local = [...arrayLiteral('IMAGE_LOCAL_TOOL_NAMES'), ...containerLocal(), ...repoIndexTools()];
    for (const name of HANDSHAKE_ONLY_TOOLS) {
      expect([...relay, ...local]).toContain(name);
    }
  });
});
