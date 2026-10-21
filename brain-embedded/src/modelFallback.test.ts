import { describe, expect, it, vi } from 'vitest';
import { createModelFallbackChannel, modelFallbackText } from './modelFallback';

describe('createModelFallbackChannel', () => {
  it('keeps the latest fallback until cleared and notifies subscribers', () => {
    const channel = createModelFallbackChannel();
    const listener = vi.fn();
    const stop = channel.subscribe(listener);
    expect(channel.latest()).toBeNull();
    channel.report({ from: 'anthropic/claude-sonnet-4', reason: '503' });
    expect(channel.latest()).toEqual({ from: 'anthropic/claude-sonnet-4', reason: '503' });
    channel.clear();
    expect(channel.latest()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    channel.report({ from: 'x', reason: 'y' });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('fills the {model} token of a localized template', () => {
    expect(modelFallbackText('Ihre Wahl {model} schlug fehl.', { from: 'openai/gpt-5' })).toBe('Ihre Wahl openai/gpt-5 schlug fehl.');
  });
});
