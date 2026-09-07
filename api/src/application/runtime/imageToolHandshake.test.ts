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
import { CONTAINER_AGENT_TOOLS } from './cloudAgentTools';

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, '../../..');
const relayModule = readFileSync(resolve(apiRoot, 'container/agentRelay.mjs'), 'utf8');

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

  it('every tool the container surface advertises is one an image can dispatch', () => {
    // The core consolidation invariant. `CONTAINER_AGENT_TOOLS` is derived from the
    // capability set in TypeScript; the dispatch table is JavaScript in two shipped
    // images. Nothing but this test connects them.
    const relay = arrayLiteral('RELAY_TOOL_NAMES');
    const local = arrayLiteral('IMAGE_LOCAL_TOOL_NAMES');
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

  it('everything gated behind the handshake is something a current image dispatches', () => {
    // A gated tool no image implements would be permanently invisible: withheld from an
    // old image by the gate, and from a new one by the intersection.
    const relay = arrayLiteral('RELAY_TOOL_NAMES');
    const local = arrayLiteral('IMAGE_LOCAL_TOOL_NAMES');
    for (const name of HANDSHAKE_ONLY_TOOLS) {
      expect([...relay, ...local]).toContain(name);
    }
  });
});
