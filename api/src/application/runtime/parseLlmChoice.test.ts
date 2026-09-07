import { describe, expect, it } from 'vitest';
import { parseLlmChoice } from './cloudAgentEngine';

/** GAP B1 — the cloud turn reader carries the reasoning path, not only content + tools. */
describe('parseLlmChoice', () => {
  it('returns content, reasoning and tool calls off a chat-completion body', () => {
    const out = parseLlmChoice({
      choices: [{
        message: {
          content: 'Reading the file.',
          reasoning_content: 'Need the current shape first.',
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{}' } }],
        },
      }],
    });
    expect(out.content).toBe('Reading the file.');
    expect(out.reasoning).toBe('Need the current shape first.');
    expect(out.toolCalls).toHaveLength(1);
  });

  it('degrades to empty fields on a malformed body', () => {
    expect(parseLlmChoice(null)).toEqual({ content: '', reasoning: '', toolCalls: [] });
    expect(parseLlmChoice({ choices: [] })).toEqual({ content: '', reasoning: '', toolCalls: [] });
  });
});
