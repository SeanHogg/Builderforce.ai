import { describe, expect, it } from 'vitest';
import { classifyTool } from '@builderforce/agent-tools';
import { builtinToolMutates, resolveCloudAgentPlatformTool } from '../llm/builtinMcpService';
import { platformTools } from './cloudAdapterTools';

/**
 * The cloud run declares each curated platform tool's `mutates` flag from the builtin catalog, so a governance class gate
 * ("block every mutating tool") withholds the writes and leaves the read-only builtins available.
 */
describe('cloud platform tools declare their mutates flag', () => {
  const tools = platformTools({ env: {} as never, db: {} as never, tenantId: 1, projectId: 1, meterExecutionId: 1, executionId: 1 });
  const names = tools.schemas().map((s) => s.function.name);

  it('declares every curated tool from the catalog flag', () => {
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const declared = tools.declared?.(name);
      const flag = builtinToolMutates(resolveCloudAgentPlatformTool(name)!);
      expect(declared, name).toEqual(flag === undefined ? undefined : { mutates: flag });
    }
  });

  it('classifies a declared read as a read and a declared write as a mutation', () => {
    const read = names.find((n) => tools.declared?.(n)?.mutates === false);
    const write = names.find((n) => tools.declared?.(n)?.mutates === true);
    expect(read, 'at least one read-only curated tool').toBeDefined();
    expect(write, 'at least one writing curated tool').toBeDefined();
    expect(classifyTool(read!, tools.declared!(read!))).toBe('read');
    expect(classifyTool(write!, tools.declared!(write!))).toBe('mutate');
  });

  it('declares nothing for a tool it does not run', () => {
    expect(tools.declared?.('not_a_platform_tool')).toBeUndefined();
  });
});
