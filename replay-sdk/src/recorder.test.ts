import { afterEach, describe, expect, it, vi } from 'vitest';
import { attach, session } from './publicApi';
import { unmask } from './masking';

afterEach(() => {
  session.stop();
});

describe('public session API', () => {
  it('queues identify / setTag / track until the recorder attaches', () => {
    const identify = vi.fn();
    const setTag = vi.fn();
    const track = vi.fn();
    session.identify('u1', { plan: 'pro' });
    session.setTag('env', 'test');
    session.track('signup');
    attach({
      init: vi.fn(),
      identify,
      setTag,
      track,
      stop: vi.fn(),
      unmask: vi.fn(),
    });
    expect(identify).toHaveBeenCalledWith('u1', { plan: 'pro' });
    expect(setTag).toHaveBeenCalledWith('env', 'test');
    expect(track).toHaveBeenCalledWith('signup', undefined);
  });

  it('exposes unmask on the same object', () => {
    expect(typeof unmask).toBe('function');
    expect(typeof session.unmask).toBe('function');
  });
});
