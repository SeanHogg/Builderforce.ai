import { describe, expect, it, vi } from 'vitest';
import { errorReport, installUncaughtErrorRelay } from './uncaughtErrorRelay';

/** A window stand-in that records its listeners, so events can be fired by hand. */
function fakeWindow() {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  return {
    addEventListener: (type: string, listener: (event: Event) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => listeners.get(type)?.delete(listener),
    fire: (type: string, event: object) => listeners.get(type)?.forEach((listener) => listener(event as Event)),
    count: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
  };
}

describe('the uncaught-error relay', () => {
  it('reports window errors and unhandled rejections, and uninstalls cleanly', () => {
    const target = fakeWindow();
    const report = vi.fn();
    const uninstall = installUncaughtErrorRelay(report, target as never);

    const thrown = new Error('handler blew up');
    target.fire('error', { error: thrown, message: thrown.message });
    target.fire('unhandledrejection', { reason: new Error('nobody awaited me') });
    expect(report).toHaveBeenNthCalledWith(1, expect.objectContaining({ source: 'error', message: 'handler blew up', stack: thrown.stack }));
    expect(report).toHaveBeenNthCalledWith(2, expect.objectContaining({ source: 'unhandledrejection', message: 'nobody awaited me' }));

    uninstall();
    expect(target.count()).toBe(0);
  });

  it('ignores a resource load failure, which carries no error and no message', () => {
    const target = fakeWindow();
    const report = vi.fn();
    installUncaughtErrorRelay(report, target as never);
    target.fire('error', {});
    expect(report).not.toHaveBeenCalled();
  });

  it('describes any thrown value', () => {
    expect(errorReport('unhandledrejection', 'plain').message).toBe('plain');
    expect(errorReport('unhandledrejection', { code: 7 }).message).toBe('{"code":7}');
    expect(errorReport('unhandledrejection', undefined).message).toBe('unknown error');
    expect(errorReport('render', new Error('x'), '\n in A').componentStack).toBe('\n in A');
  });
});
