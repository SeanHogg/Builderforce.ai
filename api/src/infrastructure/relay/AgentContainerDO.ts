import { createDurableErrorReporter, type DurableErrorReporter } from '../../application/observability/durableErrorReporter';
/**
 * AgentContainerDO — the control plane of the **run sandbox**: the Cloudflare Container
 * a cloud run's shell and working tree live in (`api/container/server.mjs`).
 *
 * Every cloud run, on every plan, runs ONE engine (`cloudAgentEngine.ts`, ticked by
 * {@link CloudRunnerDO}). This DO starts/stops the container and proxies the engine's
 * `/sandbox/*` calls to it (`application/runtime/sandbox/runSandbox.ts`); the container
 * executes what a Worker cannot — a real shell, a clone, a dev server — and decides
 * nothing. It also serves the web-scan stages and the live-preview passthrough.
 *
 * Bound in wrangler.toml as `AGENT_CONTAINER` (a `[[containers]]` block backed by this
 * class). One instance per execution (`idFromName('exec:<id>')`); web scans and managed
 * hosts use their own names.
 */
import { Container } from '@cloudflare/containers';
import { PREVIEW_CONTROL_STOP_PATH } from '../../application/runtime/previewSessions';
import { decideJobKeepAlive } from '../../application/runtime/sandbox/jobKeepAlive';
import { egressAllowlistHandler, egressEnforced, execIdFromName, internalApiHost, isRunSandboxName, type EgressHandlerParams } from '../../application/runtime/sandbox/egressAllowlist';
import type { Env } from '../../env';

const EXEC_KEY = 'executionId';
/** The slice of the `/sandbox/open` spec this DO reads. */
interface OpenBody { executionId?: number; preview?: { port?: number } }
/** Persisted marker that this instance is a run sandbox under the egress allowlist. */
const EGRESS_KEY = 'egressPolicy';
/** Written by {@link AgentContainerDO.onStart} only when the container ACTUALLY started with
 *  `enableInternet = false`; a running container without it started open and must be destroyed. */
const STARTED_RESTRICTED_KEY = 'egressStartedRestricted';
/** When the current job keep-alive began (see `jobKeepAlive.ts`); absent = none in effect. */
const KEEPALIVE_SINCE_KEY = 'jobKeepAliveSince';
/** The library's own persisted outbound-interception config (`container.js` OUTBOUND_CONFIGURATION_KEY).
 *  Its presence on a rebuilt instance means a handler override and intercept-all were set earlier. */
const LIBRARY_OUTBOUND_KEY = 'OUTBOUND_CONFIGURATION';
/** A destroy that has not returned by now is treated as failed (the gate answers 503 and retries). */
export const DESTROY_TIMEOUT_MS = 10_000;

type DoCtx = ConstructorParameters<typeof Container>[0];
const nameOf = (ctx: unknown): string | undefined => (ctx as { id?: { name?: string } }).id?.name;
/** Synchronous (it runs before `super()`): does persisted state say this instance was restricted? */
function hasPersistedEgress(ctx: DoCtx): boolean {
  try {
    const kv = (ctx as { storage?: { kv?: { get(key: string): unknown } } }).storage?.kv;
    return !!kv && (kv.get(LIBRARY_OUTBOUND_KEY) !== undefined || kv.get(EGRESS_KEY) !== undefined);
  } catch { return false; }
}
/** How long the "is a job running?" probe may take. A wedged container process that never answers
 *  must read as "no job", not hold the idle handler open (and renew the timer) forever. */
export const JOB_PROBE_TIMEOUT_MS = 10_000;

export class AgentContainerDO extends Container<Env> {
  /** Bound once here so no call site can forget the runtime override. */
  private readonly reportError: DurableErrorReporter =
    createDurableErrorReporter('infrastructure/relay/AgentContainerDO.ts', this.env, this.ctx);

  /** The container's HTTP server listens here (see api/container/server.mjs). */
  defaultPort = 8080;

  /**
   * Keep the container warm briefly after the last request so a follow-up run on the
   * same execution reuses the warm process; then it sleeps to stop billing.
   *
   * This 20m is sized for a RUN, and deliberately stays that way: a container can sit
   * quiet for minutes inside one `run_command` (an install, a build, a test suite), and
   * a tighter global timer would kill healthy work in progress. A live PREVIEW has the
   * opposite shape — it is watched or it is abandoned — so it is evicted on its own,
   * much tighter policy by the preview sweep (`PREVIEW_IDLE_EVICTION_MS`), which stops
   * this container through {@link PREVIEW_CONTROL_STOP_PATH} below. Two lifetimes,
   * because there are two consumption shapes; one `sleepAfter` cannot express both.
   */
  sleepAfter = '20m';

  /**
   * Default for instances that are NOT run sandboxes (web scans must reach arbitrary
   * targets), and for every instance while enforcement is off. An enforced run sandbox
   * flips this off in {@link gateEgress} and has all its
   * outbound HTTP(S) routed through the allowlist handler.
   */
  enableInternet = true;

  /**
   * Intercept HTTPS too, so the allowlist sees TLS traffic (the image trusts the platform CA,
   * `api/container/egressTrust.mjs`). A plain field: it does nothing until the library's
   * interception path runs, and that path never runs while enforcement is off.
   */
  interceptHttps = true;

  /**
   * Register the allowlist handler with the library, by ASSIGNMENT through the base class's
   * `static set outboundHandlers` (a `static x = ...` field is a native define under ES2022 and
   * would bypass the setter). Deliberately NOT done at class definition: the library turns
   * interception on for any class whose registry is non-empty when an instance is constructed
   * (`container.js` constructor), which would run `applyOutboundInterception` — needing
   * `ctx.exports.ContainerProxy` and writing storage — for every instance, flag or not.
   * Called only when enforcement is on, before `super()` (so a persisted handler override
   * validates when the library restores it) and again before the first `setOutboundHandler`.
   * Idempotent.
   *
   * The registry is per CLASS per ISOLATE, not per instance: once any run sandbox registers, every
   * instance constructed LATER in that isolate (web scans, managed hosts) also sees a non-empty
   * registry, so the library marks them `usingInterception`. They stay unrestricted — with no
   * handler override, allow list or deny list the library runs in per-host mode with ZERO hosts
   * (no `intercept*` calls) — but each start does run `applyOutboundInterception` (needs
   * `ctx.exports.ContainerProxy`, one config write).
   */
  private static registerEgressHandler(): void {
    AgentContainerDO.outboundHandlers = { egressAllowlist: egressAllowlistHandler };
  }

  constructor(ctx: DoCtx, env: Env, options?: ConstructorParameters<typeof Container>[2]) {
    // Nothing touches `this` before super(); with enforcement off nothing at all happens here.
    const enforced = egressEnforced(env);
    if (enforced) {
      // Register for every instance that might be (or have been) a run sandbox. An UNDEFINED name
      // must register too: otherwise an evicted exec DO rebuilt without its name would have its
      // persisted override dropped by the library while intercept-all is kept, and the constructor
      // would apply interception with open internet and no catch-all handler.
      const name = nameOf(ctx);
      if (isRunSandboxName(name) || name === undefined || hasPersistedEgress(ctx)) AgentContainerDO.registerEgressHandler();
    }
    super(ctx, env, options);
    // A container left running from before a restart/eviction must have started restricted.
    if (enforced) void this.ctx.blockConcurrencyWhile(() => this.destroyIfStartedOpen());
  }

  /** In-memory egress verdict for this instance: unknown (not yet decided), open (not a run
   *  sandbox — cached so scans pay no storage read), or applied (policy in force). */
  private egressState: 'unknown' | 'open' | 'applied' = 'unknown';
  private egressDisabledLogged = false;
  /** Tail of the serialized gate chain: concurrent requests queue behind ONE in-flight gate. */
  private egressGateTail: Promise<unknown> = Promise.resolve();

  /**
   * Keep {@link STARTED_RESTRICTED_KEY} equal to "the CURRENT container started without internet".
   * Written only when enforcement is on and internet really is off; cleared on ANY start that has
   * internet (e.g. enforcement was toggled off, then on mid-run), so a stale marker can never vouch
   * for an open-started container. Off, the cost is one read and no write unless a marker exists.
   */
  override async onStart(): Promise<void> {
    if (this.enableInternet === false) {
      if (egressEnforced(this.env)) await this.ctx.storage.put(STARTED_RESTRICTED_KEY, true);
    } else if ((await this.ctx.storage.get(STARTED_RESTRICTED_KEY)) !== undefined) {
      await this.ctx.storage.delete(STARTED_RESTRICTED_KEY);
    }
  }

  /** SIGKILL the container and confirm it is gone. A hung destroy is abandoned after
   *  {@link DESTROY_TIMEOUT_MS} (it throws, so the gate fails closed with a 503 and the next request retries). */
  private async destroyAndConfirm(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const destroyed = this.destroy();
    destroyed.catch(() => undefined); // a late rejection after the race has no awaiter
    await Promise.race([
      destroyed,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('container destroy timed out')), DESTROY_TIMEOUT_MS); }),
    ]).finally(() => clearTimeout(timer));
    await this.waitUntilStopped();
    await this.ctx.storage.delete(STARTED_RESTRICTED_KEY);
  }

  /**
   * Run once per construction with enforcement on: a restricted-looking instance whose container is
   * already running but never recorded a restricted start (it started open, e.g. before enforcement
   * was enabled) is destroyed now rather than waiting for the next request. Never throws: this runs
   * inside `blockConcurrencyWhile`, where a throw would reset the DO.
   */
  private async destroyIfStartedOpen(): Promise<void> {
    try {
      if (!this.ctx.container?.running) return;
      const restricted = isRunSandboxName(nameOf(this.ctx)) || hasPersistedEgress(this.ctx) || (await this.ctx.storage.get(EXEC_KEY)) !== undefined;
      if (!restricted || (await this.ctx.storage.get(STARTED_RESTRICTED_KEY)) === true) return;
      await this.destroyAndConfirm();
    } catch (error) {
      this.reportError(error, { operation: 'destroyIfStartedOpen', level: 'warning' });
    }
  }

  /**
   * Gate every proxied request on the egress policy. Returns a Response to answer with
   * (fail closed: a run sandbox whose policy cannot be applied is never proxied), or null to
   * proceed. Off unless `SANDBOX_EGRESS_ENFORCE=true`; off, nothing here runs but one log line.
   * Concurrent calls are serialized so a request arriving mid-destroy waits for it.
   */
  private gateEgress(openBody: OpenBody | null): Promise<Response | null> {
    if (!egressEnforced(this.env)) {
      if (!this.egressDisabledLogged) {
        this.egressDisabledLogged = true;
        console.info(JSON.stringify({ event: 'sandbox.egress.enforcement_disabled', note: 'SANDBOX_EGRESS_ENFORCE is not "true"' }));
      }
      return Promise.resolve(null);
    }
    if (this.egressState === 'open') return Promise.resolve(null);
    if (this.egressState === 'applied' && !openBody) return Promise.resolve(null);
    const run = this.egressGateTail.then(() => this.applyEgressGate(openBody));
    this.egressGateTail = run.catch(() => undefined);
    return run;
  }

  /**
   * Identity, not request order, decides: run sandboxes are the `exec:*` instances. The flag is
   * persisted BEFORE anything is applied, so a restart restricts the instance even when applying
   * fails. A container running without {@link STARTED_RESTRICTED_KEY} started with open internet
   * and is destroyed (SIGKILL) and confirmed gone before the policy is applied.
   */
  private async applyEgressGate(openBody: OpenBody | null): Promise<Response | null> {
    if (this.egressState === 'open') return null;
    if (this.egressState === 'applied' && !openBody) return null;
    try {
      const name = (this.ctx.id as { name?: string } | undefined)?.name;
      if (name !== undefined && !isRunSandboxName(name)) { this.egressState = 'open'; return null; }
      const saved = await this.ctx.storage.get<{ executionId: number | null; internalHost: string | null }>(EGRESS_KEY);
      const execKey = await this.ctx.storage.get<number>(EXEC_KEY);
      if (!isRunSandboxName(name) && !saved && execKey === undefined && !openBody && !hasPersistedEgress(this.ctx)) {
        // Nameless instance and nothing persisted says it is a run sandbox: let it through (a scan or
        // managed host must not get a permanent 503). NOT cached — if this turns out to be an exec
        // sandbox, its `/sandbox/open` arrives later and is gated normally.
        return null;
      }
      const executionId = typeof openBody?.executionId === 'number' ? openBody.executionId : saved?.executionId ?? execKey ?? null;
      const internalHost = internalApiHost(this.env);
      if (this.egressState === 'applied' && saved?.executionId === executionId) return null;
      await this.ctx.storage.put(EGRESS_KEY, { executionId, internalHost });
      this.enableInternet = false;
      const marker = await this.ctx.storage.get(STARTED_RESTRICTED_KEY);
      if (this.ctx.container?.running) {
        if (marker !== true) await this.destroyAndConfirm();
      } else if (marker !== undefined) {
        // Not running: any marker is stale (the next start rewrites it in onStart).
        await this.ctx.storage.delete(STARTED_RESTRICTED_KEY);
      }
      AgentContainerDO.registerEgressHandler();
      // `setOutboundHandler` does not enable interception itself (only the constructor and the
      // allow/deny setters do); an instance built before registration needs it on, or the
      // library's refresh is a no-op and the container would start open.
      this.usingInterception = true;
      await this.setOutboundHandler<EgressHandlerParams>('egressAllowlist', { executionId, internalHost });
      this.egressState = 'applied';
      return null;
    } catch (error) {
      this.reportError(error, { operation: 'gateEgress' });
      return Response.json({ ok: false, error: 'sandbox egress policy could not be applied' }, { status: 503 });
    }
  }

  private async waitUntilStopped(): Promise<void> {
    for (let i = 0; i < 100 && this.ctx.container?.running; i++) await new Promise((r) => setTimeout(r, 100));
    if (this.ctx.container?.running) throw new Error('container did not stop before the egress policy');
  }

  /**
   * Capture the executionId off `/sandbox/open` so {@link onError} can attribute a hard
   * container death (OOM / evicted / unbootable image) to the run it served — the DO id
   * name (`exec:<id>`) is one-way. Best-effort; never blocks the proxied request.
   */
  override async fetch(request: Request): Promise<Response> {
    let openBody: OpenBody | null = null;
    try {
      const url = new URL(request.url);
      // Idle-preview eviction. Terminal, and handled BEFORE the container proxy so it
      // never reaches the image: the point is to release the INSTANCE, and a request
      // forwarded into the container would only keep it alive.
      if (request.method === 'POST' && url.pathname === PREVIEW_CONTROL_STOP_PATH) {
        // A preview stop wins over any job keep-alive: the instance goes, and so does the clock.
        await this.ctx.storage.delete(KEEPALIVE_SINCE_KEY);
        await this.stop();
        return new Response(null, { status: 204 });
      }
      if (request.method === 'POST' && url.pathname === '/sandbox/open') {
        const body = (await request.clone().json().catch(() => null)) as OpenBody | null;
        if (body && typeof body.executionId === 'number') {
          // An `exec:<id>` sandbox only ever serves run <id>; refuse an open for another run.
          const nameId = execIdFromName(nameOf(this.ctx));
          if (egressEnforced(this.env) && nameId !== null && nameId !== body.executionId) {
            return Response.json({ ok: false, error: 'executionId does not match this sandbox' }, { status: 400 });
          }
          await this.ctx.storage.put(EXEC_KEY, body.executionId);
          openBody = body;
        }
        // Hand the image the port the preview passthrough expects. `server.mjs` reads
        // PREVIEW_PORT from its process env at boot, so this MUST be set before the
        // container starts — which is what setting it on the way into the first proxied
        // request achieves. Absent (feature off) ⇒ the passthrough stays inert.
        if (body?.preview && typeof body.preview.port === 'number') {
          this.envVars = { ...(this.envVars ?? {}), PREVIEW_PORT: String(body.preview.port) };
        }
      }
    } catch (error) { /* attribution is best-effort */
      this.reportError(error, { operation: "fetch" });
    }
    // Egress policy BEFORE anything is proxied (proxying is what starts the container).
    const denied = await this.gateEgress(openBody);
    if (denied) return denied;
    // Any request forwarded to the container is real activity: the job keep-alive clock restarts.
    // (The idle probe goes through `containerFetch`, not this method, so it never resets it.)
    // Read first: the clock is almost never set, and a storage write ahead of every proxied
    // request (preview asset traffic included) is not free.
    try {
      if ((await this.ctx.storage.get<number>(KEEPALIVE_SINCE_KEY)) !== undefined) await this.ctx.storage.delete(KEEPALIVE_SINCE_KEY);
    } catch (error) { this.reportError(error, { operation: 'fetch', level: 'warning' }); }
    return super.fetch(request);
  }

  /**
   * The container crashed. The RUN is not lost: the engine owns it, and its next sandbox
   * call reopens a fresh clone of the ticket branch (which carries every committed
   * write) — so this reports, and never fails or re-dispatches the run. Re-dispatching
   * here would start a second engine beside the one still ticking.
   */
  override async onError(error: unknown): Promise<unknown> {
    const executionId = await this.ctx.storage.get<number>(EXEC_KEY).catch(() => undefined);
    this.reportError(error, { operation: "onError", context: { logMessage: '[AgentContainerDO] sandbox container error', details: { executionId } } });
    return error;
  }

  /**
   * The idle timer expired. The default is to stop; this keeps the container for a running
   * BACKGROUND job (a request-less stretch is normal for one), up to the cap in
   * {@link decideJobKeepAlive}. The library renews the timer after this returns, so a
   * kept container is asked again one `sleepAfter` later.
   */
  override async onActivityExpired(): Promise<void> {
    if (!this.ctx.container?.running) return;
    const now = Date.now();
    const since = await this.ctx.storage.get<number>(KEEPALIVE_SINCE_KEY).catch((error: unknown) => {
      this.reportError(error, { operation: 'onActivityExpired', level: 'warning' });
      return undefined; // an unreadable clock reads as no clock
    });
    const decision = decideJobKeepAlive(await this.jobRunning(), since, now);
    if (decision.since === null) await this.ctx.storage.delete(KEEPALIVE_SINCE_KEY);
    else if (decision.since !== since) await this.ctx.storage.put(KEEPALIVE_SINCE_KEY, decision.since);
    if (decision.keep) { this.renewActivityTimeout(); return; }
    await this.stop();
  }

  /** Whether the container reports a running background job. Any failure reads "none":
   *  an unreachable container is not one to keep warm. */
  private async jobRunning(): Promise<boolean> {
    try {
      const executionId = await this.ctx.storage.get<number>(EXEC_KEY);
      if (typeof executionId !== 'number') return false;
      const probe = (async () => {
        const res = await this.containerFetch('http://agent-container/sandbox/job/active', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ executionId }),
          signal: AbortSignal.timeout(JOB_PROBE_TIMEOUT_MS),
        });
        const body = (await res.json().catch((error: unknown) => {
          this.reportError(error, { operation: 'jobRunning', level: 'warning' });
          return null; // an unparseable reply reads as not active
        })) as { active?: unknown } | null;
        return body?.active === true;
      })();
      // A rejection after the race has settled has no awaiter: record it here so it is never unhandled.
      probe.catch((error: unknown) => { this.reportError(error, { operation: 'jobRunning', level: 'warning' }); });
      // The signal alone cannot be trusted to unblock a proxied fetch, so the wait is raced too.
      let timer: ReturnType<typeof setTimeout> | undefined;
      return await Promise.race([
        probe,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('job probe timed out')), JOB_PROBE_TIMEOUT_MS); }),
      ]).finally(() => clearTimeout(timer));
    } catch (error) {
      this.reportError(error, { operation: 'jobRunning', level: 'warning' });
      return false;
    }
  }
}
