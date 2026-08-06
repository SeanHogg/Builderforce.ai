import { describe, expect, it } from 'vitest';
import { nextSeedPromptStep, type SeedPromptState } from './seedPrompt';

const base: SeedPromptState = {
  prompt: 'Build me a pricing page',
  ready: true,
  alreadySent: false,
  targetChatId: null,
  targetTicket: undefined,
  activeChatId: null,
  selectionCleared: false,
};

describe('nextSeedPromptStep', () => {
  it('waits when there is no seed, it is blank, or the surface is not ready', () => {
    expect(nextSeedPromptStep({ ...base, prompt: undefined })).toBe('wait');
    expect(nextSeedPromptStep({ ...base, prompt: '   ' })).toBe('wait');
    expect(nextSeedPromptStep({ ...base, ready: false })).toBe('wait');
  });

  it('is single-use', () => {
    expect(nextSeedPromptStep({ ...base, alreadySent: true })).toBe('wait');
  });

  it('sends straight away when nothing is selected', () => {
    expect(nextSeedPromptStep(base)).toBe('send');
  });

  it('clears a restored chat first so the seed opens a NEW chat', () => {
    // The returning-visitor case: the drawer rehydrated chat 42, but the prompt
    // was typed on the home page and belongs in a fresh conversation.
    const restored = { ...base, activeChatId: 42 };
    expect(nextSeedPromptStep(restored)).toBe('clear-selection');
    // Between the clear and the re-render that reports it, hold — never send
    // into the chat we are about to leave.
    expect(nextSeedPromptStep({ ...restored, selectionCleared: true })).toBe('wait');
    // Selection gone → send, which creates the new chat.
    expect(nextSeedPromptStep({ ...restored, selectionCleared: true, activeChatId: null })).toBe('send');
  });

  it('respects a seed that names its own chat', () => {
    expect(nextSeedPromptStep({ ...base, activeChatId: 42, targetChatId: 7 })).toBe('send');
    expect(nextSeedPromptStep({ ...base, activeChatId: 42, targetTicket: { kind: 'task', ref: '9' } })).toBe('send');
  });
});
