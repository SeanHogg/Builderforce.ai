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
import { egressAllowlistHandler, egressEnforced, execIdFromName, type EgressHandlerParams } from '../../application/runtime/sandbox/egressAllowlist';
import {
  EGRESS_HANDLER_NAME,
  EXEC_KEY,
  SandboxEgressLifecycle,
  dropStaleEgressConfig,
  nameOf,
  rehydrateRestriction,
  shouldRegisterEgressHandler,
  type EgressHost,
  type OpenBody,
  type RestrictionTarget,
} from './sandboxEgressLifecycle';
import type { Env } from '../../env';

export { DESTROY_TIMEOUT_MS } from './sandboxEgressLifecycle';

/** When the current job keep-alive began (see `jobKeepAlive.ts`); absent = none in effect. */
const KEEPALIVE_SINCE_KEY = 'jobKeepAliveSince';

/**
 * The per-instance secret the container's control routes (`/sandbox/*`, `/web-scan`) require. The model's shell runs INSIDE
 * the container and can reach those routes on localhost, so a network position is not authority: this DO is the only
 * party that knows the secret (stored here, passed in the container's env at start, sent as a header on every
 * control request it forwards). `api/container/server.mjs` removes it from its own env after reading it.
 */
const CONTROL_SECRET_KEY = 'containerControlSecret';
export const CONTROL_SECRET_ENV = 'BUILDERFORCE_CONTROL_SECRET';
export const CONTROL_SECRET_HEADER = 'x-bf-control-secret';
const isControlPath = (pathname: string): boolean => pathname.startsWith('/sandbox/') || pathname === '/web-scan';

type DoCtx = ConstructorParameters<typeof Container>[0];
/** The durable reporter for this file; a function so the constructor can use it BEFORE `super()`. */
const durableReporter = (env: Env, ctx: DoCtx): DurableErrorReporter =>
  createDurableErrorReporter('infrastructure/relay/AgentContainerDO.ts', env, ctx);
/** How long the "is a job running?" probe may take. A wedged container process that never answers
 *  must read as "no job", not hold the idle handler open (and renew the timer) forever. */
export const JOB_PROBE_TIMEOUT_MS = 10_000;

export class AgentContainerDO extends Container<Env> {
  /** Bound once here so no call site can forget the runtime override. */
  private readonly reportError: DurableErrorReporter = durableReporter(this.env, this.ctx);

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
   * has this turned off (by the lifecycle's gate, and at construction when it is rebuilt) and has all
   * its outbound HTTP(S) routed through the allowlist handler.
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
    // Nothing touches `this` before super(). With enforcement off the only thing that can happen
    // here is removing OUR OWN stale interception config (see dropStaleEgressConfig).
    const report = (error: unknown, where: string) => durableReporter(env, ctx)(error, { operation: where, level: 'warning' });
    dropStaleEgressConfig(ctx, env, report);
    // Register for every instance that might be (or have been) a run sandbox, a nameless one
    // included: otherwise a rebuilt exec DO would have its persisted override dropped by the library
    // while intercept-all is kept, and interception would apply with open internet.
    if (shouldRegisterEgressHandler(ctx, env)) AgentContainerDO.registerEgressHandler();
    super(ctx, env, options);
    if (egressEnforced(env)) {
      // Back to restricted BEFORE the library's constructor callback resumes (it reads these only
      // after its first await): internet off, and our override even after an ON, OFF, ON toggle.
      rehydrateRestriction(this as unknown as RestrictionTarget, this.ctx, env, (error, where) => this.reportError(error, { operation: where, level: 'warning' }));
      // A container left running from before a restart/eviction must have started restricted.
      this.ctx.blockConcurrencyWhile(() => this.egress.destroyIfStartedOpen().then(() => undefined))
        .catch((error: unknown) => this.reportError(error, { operation: 'constructor', level: 'warning' }));
    }
  }

  /** The egress lifecycle (gate, marker, destroy). Everything about it lives in `sandboxEgressLifecycle.ts`. */
  private readonly egress = new SandboxEgressLifecycle({
    ctx: this.ctx as unknown as EgressHost['ctx'],
    env: this.env,
    destroy: () => this.destroy(),
    restrict: async (executionId, internalHost) => {
      this.enableInternet = false;
      AgentContainerDO.registerEgressHandler();
      // `setOutboundHandler` does not enable interception itself (only the constructor and the
      // allow/deny setters do); an instance built before registration needs it on, or the
      // library's refresh is a no-op and the container would start open.
      this.usingInterception = true;
      await this.setOutboundHandler<EgressHandlerParams>(EGRESS_HANDLER_NAME, { executionId, internalHost });
    },
    report: (error, operation, level) => this.reportError(error, { operation, ...(level ? { level } : {}) }),
  });

  override async onStart(): Promise<void> { await this.egress.onStart(this.enableInternet !== false); }

  override async onStop(): Promise<void> { await this.egress.onStop(); }

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
    const denied = await this.egress.gate(openBody);
    if (denied) return denied;
    // Any request forwarded to the container is real activity: the job keep-alive clock restarts.
    // (The idle probe goes through `containerFetch`, not this method, so it never resets it.)
    // Read first: the clock is almost never set, and a storage write ahead of every proxied
    // request (preview asset traffic included) is not free.
    try {
      if ((await this.ctx.storage.get<number>(KEEPALIVE_SINCE_KEY)) !== undefined) await this.ctx.storage.delete(KEEPALIVE_SINCE_KEY);
    } catch (error) { this.reportError(error, { operation: 'fetch', level: 'warning' }); }
    // A control request carries the instance secret (the caller's own copy of the header, if any, is overwritten);
    // everything else, a preview request above all, is forwarded untouched so the secret never reaches a dev server.
    let forwarded = request;
    try {
      if (isControlPath(new URL(request.url).pathname)) {
        const secret = await this.controlSecret();
        if (secret) {
          forwarded = new Request(request);
          forwarded.headers.set(CONTROL_SECRET_HEADER, secret);
        }
      }
    } catch (error) { this.reportError(error, { operation: 'fetch', level: 'warning' }); }
    return super.fetch(forwarded);
  }

  /** This instance's control secret (created once, kept in storage) — also put in the container's start env, which must happen BEFORE the container starts. Null when storage failed. */
  private async controlSecret(): Promise<string | null> {
    try {
      let secret = await this.ctx.storage.get<string>(CONTROL_SECRET_KEY);
      if (!secret) {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        secret = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
        await this.ctx.storage.put(CONTROL_SECRET_KEY, secret);
      }
      this.envVars = { ...(this.envVars ?? {}), [CONTROL_SECRET_ENV]: secret };
      return secret;
    } catch (error) {
      this.reportError(error, { operation: 'controlSecret', level: 'warning' });
      return null;
    }
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
    // A restricted instance whose container never recorded a restricted start (e.g. a destroy that
    // timed out left an open-started one alive) must not be kept warm: destroy it, or retry later.
    if (egressEnforced(this.env) && (await this.egress.destroyIfStartedOpen())) return;
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
      const secret = await this.controlSecret();
      const probe = (async () => {
        const res = await this.containerFetch('http://agent-container/sandbox/job/active', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(secret ? { [CONTROL_SECRET_HEADER]: secret } : {}) },
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
