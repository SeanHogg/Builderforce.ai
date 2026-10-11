/**
 * Public recorder API — `init`, `identify`, `setTag`, `track`, `stop`, `unmask`.
 *
 * `window.BuilderForce.session` is the same object, so the snippet and the npm
 * entry expose one surface.
 */

export interface ReplayInit {
  /** Site public key. Required. */
  key: string;
  /** Ingest origin. Default `https://api.builderforce.ai`. */
  endpoint?: string;
  /** CDN origin for the hashed recorder. Default `https://cdn.builderforce.ai`. */
  cdn?: string;
  /** 0–1. When omitted, the config endpoint decides. */
  sampleRate?: number;
}

export interface ReplaySessionApi {
  init(opts: ReplayInit): void;
  identify(userId: string, traits?: Record<string, unknown>): void;
  setTag(key: string, value: string): void;
  track(name: string, props?: Record<string, unknown>): void;
  stop(): void;
  unmask(selector: string): void;
}

type Pending =
  | { op: 'identify'; userId: string; traits?: Record<string, unknown> }
  | { op: 'setTag'; key: string; value: string }
  | { op: 'track'; name: string; props?: Record<string, unknown> }
  | { op: 'stop' }
  | { op: 'unmask'; selector: string };

let impl: ReplaySessionApi | null = null;
const queue: Pending[] = [];
let initOpts: ReplayInit | null = null;

export function attach(next: ReplaySessionApi): void {
  impl = next;
  if (initOpts) next.init(initOpts);
  for (const item of queue.splice(0, queue.length)) {
    switch (item.op) {
      case 'identify':
        next.identify(item.userId, item.traits);
        break;
      case 'setTag':
        next.setTag(item.key, item.value);
        break;
      case 'track':
        next.track(item.name, item.props);
        break;
      case 'stop':
        next.stop();
        break;
      case 'unmask':
        next.unmask(item.selector);
        break;
    }
  }
}

export const session: ReplaySessionApi = {
  init(opts) {
    initOpts = opts;
    impl?.init(opts);
  },
  identify(userId, traits) {
    if (impl) impl.identify(userId, traits);
    else queue.push({ op: 'identify', userId, traits });
  },
  setTag(key, value) {
    if (impl) impl.setTag(key, value);
    else queue.push({ op: 'setTag', key, value });
  },
  track(name, props) {
    if (impl) impl.track(name, props);
    else queue.push({ op: 'track', name, props });
  },
  stop() {
    if (impl) impl.stop();
    else queue.push({ op: 'stop' });
  },
  unmask(selector) {
    if (impl) impl.unmask(selector);
    else queue.push({ op: 'unmask', selector });
  },
};

export function installGlobal(): ReplaySessionApi {
  const w = window as unknown as { BuilderForce?: { session?: ReplaySessionApi } };
  w.BuilderForce = w.BuilderForce ?? {};
  w.BuilderForce.session = session;
  return session;
}
