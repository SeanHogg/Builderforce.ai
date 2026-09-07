import { describe, it, expect, beforeEach } from 'vitest';
import {
  setLastResolvedModel,
  getLastResolvedModel,
  forgetResolvedModels,
  withObservedModel,
} from './lastResolvedModel';

beforeEach(() => {
  forgetResolvedModels();
});

describe('the model that served a chat', () => {
  it('is remembered per conversation, not per process', () => {
    // The failure this replaces: one module-level slot, so whichever run answered LAST
    // spoke for every chat. Runs are concurrent on a host that owns them, so that is
    // not a corner case — it is the normal shape of two chats working at once.
    setLastResolvedModel(1, 'xai-oauth/grok-4.5');
    setLastResolvedModel(2, 'direct/minimax/MiniMax-M1');
    expect(getLastResolvedModel(1)).toBe('xai-oauth/grok-4.5');
    expect(getLastResolvedModel(2)).toBe('direct/minimax/MiniMax-M1');
  });

  it('knows nothing about a chat that has not had a turn', () => {
    expect(getLastResolvedModel(99)).toBeUndefined();
  });

  it('keeps the last known answer when a turn reports no model', () => {
    setLastResolvedModel(1, 'xai-oauth/grok-4.5');
    setLastResolvedModel(1, undefined);
    setLastResolvedModel(1, '   ');
    expect(getLastResolvedModel(1)).toBe('xai-oauth/grok-4.5');
  });

  it('bounds itself, dropping the least recently active chat', () => {
    for (let id = 1; id <= 70; id += 1) setLastResolvedModel(id, `model-${id}`);
    expect(getLastResolvedModel(70)).toBe('model-70');
    expect(getLastResolvedModel(1)).toBeUndefined();
  });

  it('counts a NEW turn as activity, so a long-running chat is not evicted', () => {
    setLastResolvedModel(1, 'model-1');
    for (let id = 2; id <= 64; id += 1) setLastResolvedModel(id, `model-${id}`);
    setLastResolvedModel(1, 'model-1-again');
    setLastResolvedModel(999, 'newcomer');
    expect(getLastResolvedModel(1)).toBe('model-1-again');
  });
});

describe('withObservedModel', () => {
  beforeEach(() => {
    setLastResolvedModel(7, 'xai-oauth/grok-4.5');
  });

  it('answers the current-model tool with the model that served THIS chat', () => {
    // Both name forms: the underlying MCP tool id, and the flat gateway-safe name the
    // model sees and the run loop dispatches on.
    for (const tool of ['session.current_model', 'builtin_session_current_model']) {
      expect(withObservedModel(7, tool, {})).toEqual({ model: 'xai-oauth/grok-4.5' });
    }
  });

  it('leaves every other tool call untouched', () => {
    const args = { projectId: 11 };
    expect(withObservedModel(7, 'builtin_tasks_list', args)).toBe(args);
  });

  it('does not answer for a chat that has had no turn', () => {
    const args = {};
    expect(withObservedModel(8, 'builtin_session_current_model', args)).toBe(args);
  });

  it("keeps the model's own argument — it is looking something up, not introspecting", () => {
    const args = { model: 'claude-opus-5' };
    expect(withObservedModel(7, 'builtin_session_current_model', args)).toBe(args);
  });

  it('fills in over a blank supplied model', () => {
    expect(withObservedModel(7, 'builtin_session_current_model', { model: '  ' })).toEqual({
      model: 'xai-oauth/grok-4.5',
    });
  });

  it('survives a null argument object', () => {
    expect(withObservedModel(7, 'builtin_session_current_model', null)).toEqual({ model: 'xai-oauth/grok-4.5' });
  });
});
