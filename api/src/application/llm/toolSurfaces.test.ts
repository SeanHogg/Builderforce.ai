import { describe, expect, it } from 'vitest';
import {
  applyToolSurface,
  DEFAULT_TOOL_SURFACE,
  describeToolSurfaces,
  resolveToolSurface,
  surfaceIncludesSource,
  TOOL_SURFACES,
} from './toolSurfaces';
import { CLOUD_AGENT_PLATFORM_TOOLS } from './cloudAgentToolset';
import { BUILTIN_EXTENSION_ID } from './toolNaming';
import { CONNECTOR_EXTENSION_ID } from '../connectors/connectorTools';
import type { McpToolEntry } from './mcpExtensionService';

const entry = (
  extensionId: string,
  tool: string,
  mutates?: boolean,
): McpToolEntry => ({
  extensionId,
  tool,
  name: `${extensionId}_${tool.replace(/[^a-z0-9]+/gi, '_')}`,
  description: `does ${tool}`,
  parameters: { type: 'object', properties: {} },
  ...(mutates === undefined ? {} : { mutates }),
});

const CATALOG: McpToolEntry[] = [
  entry(BUILTIN_EXTENSION_ID, 'tasks.list', false),
  entry(BUILTIN_EXTENSION_ID, 'tasks.create', true),
  entry(BUILTIN_EXTENSION_ID, 'api_keys.create', true),
  entry(BUILTIN_EXTENSION_ID, 'security.list_findings', false),
  entry(BUILTIN_EXTENSION_ID, 'projects.list', false),
  entry(CONNECTOR_EXTENSION_ID, 'slack::post_message', true),
  entry(CONNECTOR_EXTENSION_ID, 'slack::list_channels', false),
  // A tenant's own MCP server: `mutates` is never advertised.
  entry('e7c1f0c2-1111-2222-3333-444455556666', 'do_a_thing'),
];

const ids = (tools: McpToolEntry[]): string[] => tools.map((t) => t.tool);

describe('resolveToolSurface', () => {
  it('defaults to the full catalog when nothing is named', () => {
    expect(resolveToolSurface(null)?.id).toBe(DEFAULT_TOOL_SURFACE);
    expect(resolveToolSurface(undefined)?.id).toBe(DEFAULT_TOOL_SURFACE);
    expect(resolveToolSurface('  ')?.id).toBe(DEFAULT_TOOL_SURFACE);
  });

  it('returns null for an unknown id rather than silently falling back to full', () => {
    // The whole point: a typo must be an error, not "here is everything".
    expect(resolveToolSurface('deliverey')).toBeNull();
  });

  it('publishes every surface, marking the default', () => {
    const described = describeToolSurfaces();
    expect(described.map((s) => s.id)).toEqual(TOOL_SURFACES.map((s) => s.id));
    expect(described.filter((s) => s.default).map((s) => s.id)).toEqual([DEFAULT_TOOL_SURFACE]);
  });
});

describe('applyToolSurface', () => {
  it('full changes nothing', () => {
    const surface = resolveToolSurface('full')!;
    expect(applyToolSurface(CATALOG, surface)).toEqual(CATALOG);
  });

  it('delivery keeps the delivery domains and drops platform administration', () => {
    const kept = ids(applyToolSurface(CATALOG, resolveToolSurface('delivery')!));
    expect(kept).toContain('tasks.list');
    expect(kept).toContain('tasks.create');
    expect(kept).toContain('projects.list');
    expect(kept).not.toContain('api_keys.create');
    expect(kept).not.toContain('security.list_findings');
  });

  it('delivery still carries the tenant-chosen sources whole', () => {
    const kept = ids(applyToolSurface(CATALOG, resolveToolSurface('delivery')!));
    expect(kept).toContain('slack::post_message');
    expect(kept).toContain('do_a_thing');
  });

  it('agent grants exactly the curated cloud-agent allowlist', () => {
    const kept = applyToolSurface(CATALOG, resolveToolSurface('agent')!)
      .filter((t) => t.extensionId === BUILTIN_EXTENSION_ID)
      .map((t) => t.tool);
    for (const tool of kept) expect(CLOUD_AGENT_PLATFORM_TOOLS).toContain(tool);
    expect(kept).toContain('tasks.create'); // on the allowlist
    expect(kept).not.toContain('api_keys.create'); // never
  });

  it('readonly keeps only tools that DECLARE they do not mutate — every source', () => {
    const kept = ids(applyToolSurface(CATALOG, resolveToolSurface('readonly')!));
    expect(kept).toEqual(['tasks.list', 'security.list_findings', 'projects.list', 'slack::list_channels']);
    // An external MCP tool never declares `mutates`, and unknown is treated as
    // mutating platform-wide — so it must not appear on a read-only surface.
    expect(kept).not.toContain('do_a_thing');
  });

  it('platform drops connectors and tenant MCP servers entirely', () => {
    const surface = resolveToolSurface('platform')!;
    expect(surfaceIncludesSource(surface, 'connectors')).toBe(false);
    expect(surfaceIncludesSource(surface, 'extensions')).toBe(false);
    const kept = applyToolSurface(CATALOG, surface);
    expect(kept.every((t) => t.extensionId === BUILTIN_EXTENSION_ID)).toBe(true);
  });

  it('every surface is a subset of full', () => {
    const all = new Set(ids(CATALOG));
    for (const surface of TOOL_SURFACES) {
      for (const tool of ids(applyToolSurface(CATALOG, surface))) expect(all.has(tool)).toBe(true);
    }
  });
});
