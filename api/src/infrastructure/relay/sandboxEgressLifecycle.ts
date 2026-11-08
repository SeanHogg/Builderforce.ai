/**
 * The run sandbox's egress-policy LIFECYCLE, extracted from `AgentContainerDO` so the DO keeps
 * thin hooks only. Everything here is inert unless `SANDBOX_EGRESS_ENFORCE=true`
 * (`egressEnforced`, read in `egressAllowlist.ts`), apart from {@link dropStaleEgressConfig} and
 * the marker clear in {@link SandboxEgressLifecycle.onStart}, which exist to undo our own state.
 *
 * Vocabulary:
 *  - RESTRICTED instance: an `exec:*` DO, or any DO whose persisted state says WE restricted it
 *    ({@link hasPersistedEgress}). A web scan or managed host is never restricted, named or not.
 *  - STARTED-RESTRICTED marker: "the CURRENT container started with `enableInternet = false`",
 *    written by `onStart`, cleared by every open start, by `onStop`, and by the gate.
 */
import { egressEnforced, execIdFromName, internalApiHost, isRunSandboxName } from '../../application/runtime/sandbox/egressAllowlist';
import type { Env } from '../../env';

export const EXEC_KEY = 'executionId';
/** Persisted marker that this instance is a run sandbox under the egress allowlist. */
export const EGRESS_KEY = 'egressPolicy';
/** Written only when the container ACTUALLY started with `enableInternet = false`; a running
 *  container without it started open and must be destroyed. */
export const STARTED_RESTRICTED_KEY = 'egressStartedRestricted';
/** The library's own persisted interception config (`container.js` OUTBOUND_CONFIGURATION_KEY). */
export const LIBRARY_OUTBOUND_KEY = 'OUTBOUND_CONFIGURATION';
/** Name of our handler in the library's `outboundHandlers` registry. */
export const EGRESS_HANDLER_NAME = 'egressAllowlist';
/** A destroy that has not returned by now is treated as failed (the gate answers 503 and retries). */
export const DESTROY_TIMEOUT_MS = 10_000;

/** The slice of the `/sandbox/open` spec the DO reads. */
export interface OpenBody { executionId?: number; preview?: { port?: number } }

type Kv = { get(key: string): unknown; delete?(key: string): unknown };
type PersistedConfig = { outboundHandlerOverride?: { method?: string; params?: unknown } };

export const nameOf = (ctx: unknown): string | undefined => (ctx as { id?: { name?: string } }).id?.name;
const kvOf = (ctx: unknown): Kv | undefined => (ctx as { storage?: { kv?: Kv } }).storage?.kv;

/**
 * Synchronous (it runs before `super()`): does persisted state say WE restricted this instance?
 * Either our own {@link EGRESS_KEY}, or a library config whose handler override is ours. A bare
 * library config does NOT count: once any exec instance registers in an isolate, the library
 * writes a (per-host, zero-host) config for every later instance, scans and managed hosts included.
 */
export function hasPersistedEgress(ctx: unknown): boolean {
  try {
    const kv = kvOf(ctx);
    if (!kv) return false;
    if (kv.get(EGRESS_KEY) !== undefined) return true;
    return (kv.get(LIBRARY_OUTBOUND_KEY) as PersistedConfig | undefined)?.outboundHandlerOverride?.method === EGRESS_HANDLER_NAME;
  } catch { return false; }
}

/** Should the allowlist handler be registered before `super()`? (Enforcement on, and this is — or
 *  might be, when nameless — a run sandbox.) A nameless rebuild MUST register, or the library drops
 *  the persisted override while keeping intercept-all. */
export function shouldRegisterEgressHandler(ctx: unknown, env: Pick<Env, 'SANDBOX_EGRESS_ENFORCE'>): boolean {
  if (!egressEnforced(env)) return false;
  const name = nameOf(ctx);
  return isRunSandboxName(name) || name === undefined || hasPersistedEgress(ctx);
}

/**
 * Enforcement OFF and no container running: delete OUR persisted interception config (the one that
 * carries the allowlist override). Rebuilding with the flag off would otherwise make the library
 * drop the unregistered override but re-persist intercept-all with no handler. With a container
 * running we leave it: the library re-applies interception to a live container from this config,
 * and removing it would not un-intercept anything.
 */
export function dropStaleEgressConfig(ctx: unknown, env: Pick<Env, 'SANDBOX_EGRESS_ENFORCE'>): void {
  try {
    if (egressEnforced(env) || (ctx as { container?: { running?: boolean } }).container?.running) return;
    const kv = kvOf(ctx);
    const cfg = kv?.get(LIBRARY_OUTBOUND_KEY) as PersistedConfig | undefined;
    if (kv?.delete && cfg?.outboundHandlerOverride?.method === EGRESS_HANDLER_NAME) kv.delete(LIBRARY_OUTBOUND_KEY);
  } catch { /* best effort */ }
}

/** The library fields the rehydrate step sets (`outboundHandlerOverride` is not in its .d.ts). */
export interface RestrictionTarget { enableInternet: boolean; outboundHandlerOverride?: { method: string; params?: unknown } }

/**
 * Synchronously after `super()`: a rebuilt restricted instance starts with `enableInternet = true`
 * (a field default) and — after an ON, OFF, ON toggle — with intercept-all and NO handler override,
 * so the library's open fetch fallback would run. Put both back. This lands in time: the library's
 * constructor callback reads `enableInternet` and the override only after its first `await`
 * (`container.js`: `await this.scheduleNextAlarm()` precedes `applyOutboundInterception`).
 */
export function rehydrateRestriction(target: RestrictionTarget, ctx: unknown, env: Pick<Env, 'SANDBOX_EGRESS_ENFORCE' | 'INTERNAL_API_BASE_URL'>): void {
  if (!egressEnforced(env)) return;
  const name = nameOf(ctx);
  if (!isRunSandboxName(name) && !hasPersistedEgress(ctx)) return;
  target.enableInternet = false;
  if (target.outboundHandlerOverride?.method === EGRESS_HANDLER_NAME) return; // the library restored ours
  let saved: { executionId?: number | null; internalHost?: string | null } | undefined;
  try { saved = kvOf(ctx)?.get(EGRESS_KEY) as typeof saved; } catch { /* unreadable ⇒ defaults */ }
  target.outboundHandlerOverride = {
    method: EGRESS_HANDLER_NAME,
    params: { executionId: execIdFromName(name) ?? saved?.executionId ?? null, internalHost: saved?.internalHost ?? internalApiHost(env) },
  };
}

interface EgressStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<unknown>;
}

/** What the lifecycle needs from its DO. */
export interface EgressHost {
  ctx: { id?: { name?: string }; storage: EgressStorage; container?: { running: boolean } };
  env: Pick<Env, 'SANDBOX_EGRESS_ENFORCE' | 'INTERNAL_API_BASE_URL'>;
  destroy(): Promise<void>;
  /** Drop internet, register the handler, turn interception on, install the override. */
  restrict(executionId: number | null, internalHost: string | null): Promise<void>;
  report(error: unknown, operation: string, level?: 'warning'): void;
}

export class SandboxEgressLifecycle {
  /** unknown (not decided), open (not a run sandbox — cached so scans pay no storage read), applied. */
  private state: 'unknown' | 'open' | 'applied' = 'unknown';
  private disabledLogged = false;
  /** Tail of the serialized gate chain: concurrent requests queue behind ONE in-flight gate. */
  private gateTail: Promise<unknown> = Promise.resolve();

  constructor(private readonly host: EgressHost) {}

  private get storage(): EgressStorage { return this.host.ctx.storage; }
  private get running(): boolean { return !!this.host.ctx.container?.running; }

  /**
   * Keep the marker equal to "the CURRENT container started without internet". Written only when
   * enforcement is on and internet really is off; cleared on ANY start with internet (e.g.
   * enforcement toggled off, then on, mid-run). Off, the cost is one read and no write unless a
   * marker exists.
   */
  async onStart(enableInternet: boolean): Promise<void> {
    if (enableInternet === false) {
      if (egressEnforced(this.host.env)) await this.storage.put(STARTED_RESTRICTED_KEY, true);
    } else if ((await this.storage.get(STARTED_RESTRICTED_KEY)) !== undefined) {
      await this.storage.delete(STARTED_RESTRICTED_KEY);
    }
  }

  /** The container stopped: whatever started it is gone, so is the claim. `onStart` never runs when
   *  the port wait throws, so without this a stale `true` could outlive its container. */
  async onStop(): Promise<void> {
    if (egressEnforced(this.host.env)) await this.storage.delete(STARTED_RESTRICTED_KEY);
  }

  /** SIGKILL and confirm gone; a hung destroy is abandoned after {@link DESTROY_TIMEOUT_MS} (throws). */
  async destroyAndConfirm(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const destroyed = this.host.destroy();
    destroyed.catch(() => undefined); // a late rejection after the race has no awaiter
    await Promise.race([
      destroyed,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('container destroy timed out')), DESTROY_TIMEOUT_MS); }),
    ]).finally(() => clearTimeout(timer));
    await this.waitUntilStopped();
    await this.storage.delete(STARTED_RESTRICTED_KEY);
  }

  private async waitUntilStopped(): Promise<void> {
    for (let i = 0; i < 100 && this.running; i++) await new Promise((r) => setTimeout(r, 100));
    if (this.running) throw new Error('container did not stop before the egress policy');
  }

  private async isRestricted(): Promise<boolean> {
    const name = nameOf(this.host.ctx);
    if (name !== undefined && !isRunSandboxName(name)) return false; // a scan / managed host is never ours
    return isRunSandboxName(name) || hasPersistedEgress(this.host.ctx) || (await this.storage.get(EXEC_KEY)) !== undefined;
  }

  /**
   * A restricted instance whose container is running but never recorded a restricted start started
   * OPEN (before enforcement, or a destroy that timed out) and is destroyed. Returns whether it
   * acted or tried to: a caller deciding whether to keep the container alive must not when true.
   * Never throws (it may run inside `blockConcurrencyWhile`, where a throw resets the DO).
   */
  async destroyIfStartedOpen(): Promise<boolean> {
    try {
      if (!this.running || !(await this.isRestricted())) return false;
      if ((await this.storage.get(STARTED_RESTRICTED_KEY)) === true) return false;
      await this.destroyAndConfirm();
      return true;
    } catch (error) {
      this.host.report(error, 'destroyIfStartedOpen', 'warning');
      return true;
    }
  }

  /**
   * Gate every proxied request on the egress policy. A Response means "answer with this" (fail
   * closed: a run sandbox whose policy cannot be applied is never proxied); null means proceed.
   * Concurrent calls are serialized so a request arriving mid-destroy waits for it.
   */
  gate(openBody: OpenBody | null): Promise<Response | null> {
    if (!egressEnforced(this.host.env)) {
      if (!this.disabledLogged) {
        this.disabledLogged = true;
        console.info(JSON.stringify({ event: 'sandbox.egress.enforcement_disabled', note: 'SANDBOX_EGRESS_ENFORCE is not "true"' }));
      }
      return Promise.resolve(null);
    }
    if (this.state === 'open') return Promise.resolve(null);
    if (this.state === 'applied' && !openBody) return Promise.resolve(null);
    const run = this.gateTail.then(() => this.decide(openBody));
    this.gateTail = run.catch(() => undefined);
    return run;
  }

  /**
   * Identity, not request order, decides. The flag is persisted BEFORE anything is applied, so a
   * restart restricts the instance even when applying fails; the executionId of an `exec:N`
   * instance comes from its NAME first. A running container without the marker started open and is
   * destroyed and confirmed gone before the policy is applied.
   *
   * (Not done: writing the marker before a start the gate is about to cause. If `onStart` then never
   * ran and enforcement was later toggled off, that marker would vouch for an open-started container.)
   */
  private async decide(openBody: OpenBody | null): Promise<Response | null> {
    if (this.state === 'open') return null;
    if (this.state === 'applied' && !openBody) return null;
    try {
      const name = nameOf(this.host.ctx);
      if (name !== undefined && !isRunSandboxName(name)) { this.state = 'open'; return null; }
      const saved = await this.storage.get<{ executionId: number | null; internalHost: string | null }>(EGRESS_KEY);
      const execKey = await this.storage.get<number>(EXEC_KEY);
      if (!isRunSandboxName(name) && !saved && execKey === undefined && !openBody && !hasPersistedEgress(this.host.ctx)) {
        // Nameless and nothing persisted says it is a run sandbox: let it through (a scan or managed
        // host must not get a permanent 503). NOT cached — an exec sandbox's `/sandbox/open` arrives
        // later and is gated normally.
        return null;
      }
      const executionId = execIdFromName(name) ?? (typeof openBody?.executionId === 'number' ? openBody.executionId : undefined) ?? saved?.executionId ?? execKey ?? null;
      const internalHost = internalApiHost(this.host.env);
      if (this.state === 'applied' && saved?.executionId === executionId) return null;
      await this.storage.put(EGRESS_KEY, { executionId, internalHost });
      const marker = await this.storage.get(STARTED_RESTRICTED_KEY);
      if (this.running) {
        if (marker !== true) await this.destroyAndConfirm();
      } else if (marker !== undefined) {
        await this.storage.delete(STARTED_RESTRICTED_KEY); // not running ⇒ any marker is stale
      }
      await this.host.restrict(executionId, internalHost);
      this.state = 'applied';
      return null;
    } catch (error) {
      this.host.report(error, 'gateEgress');
      return Response.json({ ok: false, error: 'sandbox egress policy could not be applied' }, { status: 503 });
    }
  }
}
