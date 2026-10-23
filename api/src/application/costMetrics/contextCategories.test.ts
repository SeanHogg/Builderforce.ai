import { describe, expect, it } from 'vitest';
import { estimateTokensFromChars } from '@builderforce/workload';
import { contextCategoryTokens, toolSchemaTokens } from './contextCategories';

describe('contextCategoryTokens', () => {
  it('buckets messages by role and prices the tool schemas separately', () => {
    const tools = [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } }];
    const out = contextCategoryTokens({
      messages: [
        { role: 'system', content: 'x'.repeat(400) },
        { role: 'user', content: 'y'.repeat(80) },
        { role: 'assistant', content: '', tool_calls: [{ id: 'c1' }] },
        { role: 'tool', content: 'z'.repeat(1200) },
      ],
      tools,
      memoryTokens: 25,
    });
    expect(out.system).toBe(estimateTokensFromChars(400));
    expect(out.toolOutputs).toBe(estimateTokensFromChars(1200));
    expect(out.history).toBe(estimateTokensFromChars(80 + JSON.stringify([{ id: 'c1' }]).length));
    expect(out.tools).toBe(toolSchemaTokens(tools));
    expect(out.tools).toBeGreaterThan(0);
    expect(out.memory).toBe(25);
    expect(out.estimated).toBe(true);
  });

  it('reads an absent / bad memory figure and no tools as zero', () => {
    const out = contextCategoryTokens({ messages: [], memoryTokens: Number.NaN });
    expect(out).toMatchObject({ system: 0, tools: 0, history: 0, toolOutputs: 0, memory: 0 });
    expect(toolSchemaTokens(null)).toBe(0);
  });
});
