import { describe, expect, it, vi } from 'vitest';
import { handleFrameMessage } from './messageHandler';
import { BFEMBED_SOURCE, isFrameToHostMessage, isHostToFrameMessage } from './protocol';
import { isEmbedView, EMBED_VIEW_KEYS, EMBED_VIEWS, capabilityForView } from './views';

const ORIGIN = 'https://app.builderforce.ai';

function handlers() {
  return {
    embedOrigin: ORIGIN,
    onReady: vi.fn(),
    onResize: vi.fn(),
    onNavigate: vi.fn(),
    onError: vi.fn(),
  };
}

function evt(data: unknown, origin = ORIGIN): MessageEvent {
  return { data, origin } as MessageEvent;
}

describe('handleFrameMessage', () => {
  it('routes ready/resize/navigate/error from the trusted origin', () => {
    const h = handlers();
    handleFrameMessage(evt({ source: BFEMBED_SOURCE, type: 'ready' }), h);
    handleFrameMessage(evt({ source: BFEMBED_SOURCE, type: 'resize', height: 720 }), h);
    handleFrameMessage(evt({ source: BFEMBED_SOURCE, type: 'navigate', path: '/board/7' }), h);
    handleFrameMessage(evt({ source: BFEMBED_SOURCE, type: 'error', message: 'boom' }), h);
    expect(h.onReady).toHaveBeenCalledOnce();
    expect(h.onResize).toHaveBeenCalledWith(720);
    expect(h.onNavigate).toHaveBeenCalledWith('/board/7');
    expect(h.onError).toHaveBeenCalledWith('boom');
  });

  it('ignores messages from a foreign origin (trust boundary)', () => {
    const h = handlers();
    handleFrameMessage(evt({ source: BFEMBED_SOURCE, type: 'ready' }, 'https://evil.example'), h);
    expect(h.onReady).not.toHaveBeenCalled();
  });

  it('ignores untagged / malformed messages', () => {
    const h = handlers();
    handleFrameMessage(evt({ type: 'ready' }), h); // missing source
    handleFrameMessage(evt({ source: BFEMBED_SOURCE, type: 'resize' }), h); // missing height
    handleFrameMessage(evt('not-an-object'), h);
    expect(h.onReady).not.toHaveBeenCalled();
    expect(h.onResize).not.toHaveBeenCalled();
  });
});

describe('protocol guards', () => {
  it('validates frame→host messages', () => {
    expect(isFrameToHostMessage({ source: BFEMBED_SOURCE, type: 'ready' })).toBe(true);
    expect(isFrameToHostMessage({ source: BFEMBED_SOURCE, type: 'resize', height: 1 })).toBe(true);
    expect(isFrameToHostMessage({ source: BFEMBED_SOURCE, type: 'auth', token: 'x' })).toBe(false);
    expect(isFrameToHostMessage({ source: 'other', type: 'ready' })).toBe(false);
  });

  it('validates host→frame messages', () => {
    expect(isHostToFrameMessage({ source: BFEMBED_SOURCE, type: 'auth', token: 'jwt' })).toBe(true);
    expect(isHostToFrameMessage({ source: BFEMBED_SOURCE, type: 'auth' })).toBe(false);
    expect(isHostToFrameMessage({ source: BFEMBED_SOURCE, type: 'navigate', path: '/x' })).toBe(true);
  });
});

describe('view registry', () => {
  it('recognizes known views and rejects unknown', () => {
    expect(isEmbedView('kanban')).toBe(true);
    expect(isEmbedView('soc2')).toBe(true);
    expect(isEmbedView('not-a-view')).toBe(false);
  });

  it('has a stable, non-empty set of views across all three pillars', () => {
    expect(EMBED_VIEW_KEYS.length).toBeGreaterThanOrEqual(20);
  });

  it('maps each view to a capability (governance ⇒ security)', () => {
    expect(capabilityForView('kanban')).toBe('agile');
    expect(capabilityForView('backlog')).toBe('product');
    expect(capabilityForView('soc2')).toBe('security');
    expect(capabilityForView('approvals')).toBe('security');
  });

  it('marks kanban + backlog available (wired today) and unbuilt views unavailable', () => {
    expect(EMBED_VIEWS.kanban.available).toBe(true);
    expect(EMBED_VIEWS.backlog.available).toBe(true);
    expect(EMBED_VIEWS.soc2.available).toBe(false);
    expect(EMBED_VIEWS.poker.available).toBe(false);
  });
});
