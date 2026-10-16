import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createPublicApi, isValidEventName, looksSensitive, replayQueue, type ReplayController } from './publicApi';

type SpiedController = { [K in keyof ReplayController]: Mock<ReplayController[K]> };

function controller(): SpiedController {
  return {
    consent: vi.fn<ReplayController['consent']>(),
    event: vi.fn<ReplayController['event']>(),
    tag: vi.fn<ReplayController['tag']>(),
    identify: vi.fn<ReplayController['identify']>(),
    keep: vi.fn<ReplayController['keep']>(),
    stop: vi.fn<ReplayController['stop']>(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validation', () => {
  it('accepts event names of [\\w .:-] up to 80 chars', () => {
    expect(isValidEventName('checkout:step 2')).toBe(true);
    expect(isValidEventName('a'.repeat(80))).toBe(true);
    expect(isValidEventName('a'.repeat(81))).toBe(false);
    expect(isValidEventName('bad<script>')).toBe(false);
    expect(isValidEventName('')).toBe(false);
  });

  it('flags emails and card numbers', () => {
    expect(looksSensitive('jane@example.com')).toBe(true);
    expect(looksSensitive('4111 1111 1111 1111')).toBe(true);
    expect(looksSensitive('4111-1111-1111-1111')).toBe(true);
    expect(looksSensitive('pro')).toBe(false);
    expect(looksSensitive('12345')).toBe(false);
  });
});

describe('createPublicApi', () => {
  it('passes valid events and tags through', () => {
    const ctrl = controller();
    const api = createPublicApi(ctrl, { version: '1.0.0', identify: false });
    api.event('signup started');
    api.tag('plan', 'pro');
    expect(ctrl.event).toHaveBeenCalledWith('signup started');
    expect(ctrl.tag).toHaveBeenCalledWith('plan', 'pro');
    expect(api.version).toBe('1.0.0');
  });

  it('refuses invalid event names', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctrl = controller();
    createPublicApi(ctrl, { version: 'v', identify: false }).event('<bad>');
    expect(ctrl.event).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('refuses a tag that looks like an email or card number and names it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctrl = controller();
    const api = createPublicApi(ctrl, { version: 'v', identify: false });
    api.tag('contact', 'jane@example.com');
    api.tag('card', '4111111111111111');
    expect(ctrl.tag).not.toHaveBeenCalled();
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringContaining('"contact"'),
      expect.stringContaining('"card"'),
    ]);
  });

  it('refuses over-long keys/values and a 21st tag key', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctrl = controller();
    const keys = Array.from({ length: 20 }, (_, i) => `k${i}`);
    const api = createPublicApi(ctrl, { version: 'v', identify: false, tagKeys: () => keys });
    api.tag('x'.repeat(65), 'v');
    api.tag('k1', 'v'.repeat(201));
    api.tag('k21', 'v');
    expect(ctrl.tag).not.toHaveBeenCalled();
    api.tag('k1', 'updated');
    expect(ctrl.tag).toHaveBeenCalledWith('k1', 'updated');
  });

  it('ignores identify unless the site allows it', () => {
    const ctrl = controller();
    createPublicApi(ctrl, { version: 'v', identify: false }).identify('user-1', { tier: 'gold' });
    expect(ctrl.identify).not.toHaveBeenCalled();
    createPublicApi(ctrl, { version: 'v', identify: true }).identify('user-1', { tier: 'gold' });
    expect(ctrl.identify).toHaveBeenCalledWith('user-1', { tier: 'gold' });
  });

  it('refuses nested traits', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctrl = controller();
    createPublicApi(ctrl, { version: 'v', identify: true }).identify('u', { nested: { a: 1 } } as unknown as Record<string, string>);
    expect(ctrl.identify).not.toHaveBeenCalled();
  });
});

describe('replayQueue', () => {
  it('replays queued calls in order and empties the queue', () => {
    const ctrl = controller();
    const order: string[] = [];
    for (const k of Object.keys(ctrl) as Array<keyof ReplayController>) {
      ctrl[k].mockImplementation((...args: unknown[]) => order.push(`${k}:${args.join(',')}`));
    }
    const api = createPublicApi(ctrl, { version: 'v', identify: true });
    const queue: Array<[('consent' | 'event' | 'tag' | 'identify' | 'keep' | 'stop'), unknown[]]> = [
      ['consent', [true]],
      ['tag', ['plan', 'pro']],
      ['event', ['go']],
      ['keep', []],
    ];
    replayQueue(api, queue);
    expect(order).toEqual(['consent:true', 'tag:plan,pro', 'event:go', 'keep:']);
    expect(queue).toEqual([]);
  });
});
