/**
 * A turn that can call tools must have room to write a file.
 *
 * The Effort ceiling is an answer-length lever, but a tool call's arguments are
 * output too. A Studio build on 2026-10-03 hit Balanced's 4096 on three
 * consecutive file writes — every one cut off mid-JSON — and the agent ended by
 * handing the user CSS to paste. These pin the floor, and that it leaves
 * tool-less turns (conversation, the forced closing answer) on the Effort value.
 */
import { describe, it, expect } from 'vitest';
import { effortProfile, turnMaxTokens, TOOL_TURN_MIN_MAX_TOKENS } from './effort';

describe('turnMaxTokens', () => {
  it('raises every effort level to the floor on a turn that advertises tools', () => {
    for (const effort of ['quick', 'balanced', 'thorough'] as const) {
      expect(turnMaxTokens(effortProfile(effort).maxTokens, true)).toBeGreaterThanOrEqual(TOOL_TURN_MIN_MAX_TOKENS);
    }
    expect(turnMaxTokens(effortProfile('balanced').maxTokens, true)).toBe(TOOL_TURN_MIN_MAX_TOKENS);
  });

  it('applies the floor even when the host sent no ceiling at all', () => {
    expect(turnMaxTokens(undefined, true)).toBe(TOOL_TURN_MIN_MAX_TOKENS);
  });

  it('never lowers a ceiling that is already above the floor', () => {
    expect(turnMaxTokens(TOOL_TURN_MIN_MAX_TOKENS * 2, true)).toBe(TOOL_TURN_MIN_MAX_TOKENS * 2);
  });

  it('leaves a tool-less turn on the Effort ceiling', () => {
    expect(turnMaxTokens(effortProfile('quick').maxTokens, false)).toBe(effortProfile('quick').maxTokens);
    expect(turnMaxTokens(undefined, false)).toBeUndefined();
  });

  it('is a value every vendor already receives — Thorough’s ceiling, not a new one', () => {
    expect(TOOL_TURN_MIN_MAX_TOKENS).toBe(effortProfile('thorough').maxTokens);
  });
});
