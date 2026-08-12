import { describe, expect, it } from 'vitest';
import { isMalformedToolCall, isTruncatedTurn, turnInterruption } from './finishReason';

describe('turnInterruption', () => {
  it('reads every vendor spelling of the output ceiling as truncation', () => {
    for (const reason of ['length', 'LENGTH', 'max_tokens', 'MAX_TOKENS', 'max tokens', 'output-limit']) {
      expect(turnInterruption(reason)).toBe('truncated');
      expect(isTruncatedTurn(reason)).toBe(true);
    }
  });

  it('reads an unparseable tool call as an attempted action, not an answer', () => {
    for (const reason of ['MALFORMED_FUNCTION_CALL', 'malformed_function_call', 'invalid_tool_call']) {
      expect(turnInterruption(reason)).toBe('malformed-tool-call');
      expect(isMalformedToolCall(reason)).toBe(true);
    }
  });

  it('treats a clean stop, an unknown reason and a missing reason as uninterrupted', () => {
    for (const reason of ['stop', 'tool_calls', 'content_filter', '', '   ', null, undefined]) {
      expect(turnInterruption(reason)).toBeNull();
      expect(isTruncatedTurn(reason)).toBe(false);
      expect(isMalformedToolCall(reason)).toBe(false);
    }
  });
});
