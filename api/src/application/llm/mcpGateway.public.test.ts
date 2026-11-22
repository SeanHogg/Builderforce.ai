import { describe, expect, it } from 'vitest';
import { listPublicMcpTools, UnknownToolSurfaceError } from './mcpGateway';
import { BUILTIN_TOOL_FEATURE_GATES, BUILTIN_TOOL_PLATFORM_OPERATOR_TOOLS } from './builtinToolEntitlements';
import { BUILTIN_EXTENSION_ID } from './toolNaming';

/**
 * The ANONYMOUS discovery catalog (`tools/list` with no token on POST /mcp).
 * Registries and choosing agents see it before sign-up, so the contract is:
 * static first-party metadata ONLY — never a tenant's connectors or external
 * MCP servers, and never a feature-gated or platform-operator tool (there is
 * no tenant to check entitlements against, so the fail-safe hides them all).
 */
describe('listPublicMcpTools — the anonymous discovery catalog', () => {
  it('is non-empty and entirely first-party builtin metadata', () => {
    const tools = listPublicMcpTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((t) => t.extensionId === BUILTIN_EXTENSION_ID)).toBe(true);
    expect(tools.every((t) => typeof t.name === 'string' && t.name.length > 0)).toBe(true);
  });

  it('never advertises a feature-gated or platform-operator tool', () => {
    const privateIds = new Set([
      ...BUILTIN_TOOL_FEATURE_GATES.flatMap((gate) => gate.tools),
      ...BUILTIN_TOOL_PLATFORM_OPERATOR_TOOLS,
    ]);
    expect(privateIds.size).toBeGreaterThan(0); // the gates exist; this test is not vacuous
    const advertised = listPublicMcpTools().map((t) => t.tool);
    expect(advertised.filter((id) => privateIds.has(id))).toEqual([]);
  });

  it('honours ?surface= the same way the signed-in catalog does', () => {
    const readonly = listPublicMcpTools('readonly');
    expect(readonly.length).toBeGreaterThan(0);
    expect(readonly.every((t) => t.mutates === false)).toBe(true);
    // A surface with no builtin source has nothing public to show.
    expect(listPublicMcpTools('connectors')).toEqual([]);
  });

  it('an unknown surface is an error, not a silent full catalog', () => {
    expect(() => listPublicMcpTools('deliverey')).toThrow(UnknownToolSurfaceError);
  });
});
