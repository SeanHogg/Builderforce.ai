/**
 * The extension host's view of the page engines it can reach — one `PageEngine` per page
 * runtime in the registry, answered over brain-embedded's remote page-engine frames
 * (`createPageEngineClient`; see `pageEngineBridgeProtocol.ts` for why the engines live
 * in the webview).
 *
 * Because each is a `PageEngine`, nothing downstream changes: the host's local fetch is
 * brain-embedded's ONE shim over them (`pageEnginesFetch`), and their probes join the
 * HTTP runtimes' in the shared local-first plan. Pinned and local-first routes in
 * `modelRouting.ts` read {@link hostPageEngines} and never see postMessage.
 *
 * A second kind of port serves only some runtimes: the extension host's own `bfi`
 * worker (`hostBfi/`), the editor's CPU engine (the registry's `fallbackReach: 'host'`).
 * Every port serving a runtime is probed, and the answers are MERGED per model in rank —
 * a PREFERRED port first, then webviews (newest first), then the other fallback ports:
 * the first port offering a model owns it. The webview's `bfi` worker serves only
 * WebGPU, so it offers a Bonsai row only when the fit puts it on the GPU, and every
 * CPU-only row comes from the host worker (one resident CPU copy, never beside the chat
 * UI) — both kinds in one list. The host worker is preferred when it runs the NATIVE
 * engine (`@seanhogg/bfi-node`): its GPU is native wgpu with the native KV budget, so it
 * owns a Bonsai row even while a webview could serve it too.
 *
 * Failure is quiet by contract: with no port for a runtime (the panel closed, nothing
 * cached) a probe answers null — the runtime is simply absent — and a chat is refused with
 * a 503 the failover routes around. A port that goes away mid-answer ends that answer
 * with an error frame, never a hang; one that goes SILENT ends it after the client's
 * inactivity timeout. A webview whose probe times out with nothing heard from it is put
 * aside — a panel can vanish without `onDidDispose` — and comes back the moment it is
 * heard from again. A Stop aborts the far engine too.
 *
 * Pure — no `vscode` import — so the round trip is unit tested with a fake port.
 */
import { LOCAL_RUNTIMES, isServableLocalModel, } from "@builderforce/local-inference";
import { PageEngineError, createPageEngineClient, pageEnginesFetch, probePageEngines, } from "@seanhogg/builderforce-brain-embedded";
/** A webview that does not answer a probe this quickly is treated as not there. */
export const PAGE_ENGINE_PROBE_TIMEOUT_MS = 2_000;
/**
 * One runtime's engine over every port that serves it: every port is probed, the first
 * (in rank) that offers a model owns it, and its turns go there.
 */
function rankedEngine(client, runtime, baseUrl, ranked) {
    const owner = new Map();
    const via = (entry) => client.engine(runtime, baseUrl, () => entry.port, entry.probeTimeoutMs !== undefined ? { probeTimeoutMs: entry.probeTimeoutMs } : {});
    const engine = {
        runtime,
        baseUrl,
        async probe(probeOptions = {}) {
            const entries = ranked();
            const probes = await Promise.all(entries.map((entry) => via(entry).probe(probeOptions)));
            const merged = new Map();
            let base;
            owner.clear();
            for (const [i, probe] of probes.entries()) {
                if (!probe)
                    continue;
                base ??= probe;
                for (const m of probe.models) {
                    // First attached page wins — unless its row is not servable and this one is: a
                    // downloadable row never shadows a ready row with the same id.
                    const held = merged.get(m.model);
                    if (held && (isServableLocalModel(held) || !isServableLocalModel(m)))
                        continue;
                    merged.set(m.model, m);
                    owner.set(m.model, entries[i].port);
                }
            }
            return base && merged.size > 0 ? { ...base, models: [...merged.values()] } : null;
        },
        invalidate() {
            owner.clear();
        },
        async chatCompletions(body, signal) {
            const model = typeof body.model === "string" ? body.model : "";
            const alive = (port) => ranked().find((entry) => entry.port === port);
            // A pinned turn may arrive before any probe: ask, so the right port serves it.
            if (!alive(owner.get(model)))
                await engine.probe();
            const entry = alive(owner.get(model)) ?? ranked()[0];
            if (!entry)
                throw new PageEngineError(503, `${runtime}_unavailable`, "The chat panel that runs on-device models is closed.");
            return via(entry).chatCompletions(body, signal);
        },
    };
    return engine;
}
export function createHostPageEngineBridge(options = {}) {
    const ports = [];
    /** Webviews put aside after a silent probe timeout, until they are heard from again. */
    const dormant = new Set();
    const entryOf = (port) => ports.find((p) => p.port === port);
    const client = createPageEngineClient({
        probeTimeoutMs: options.probeTimeoutMs ?? PAGE_ENGINE_PROBE_TIMEOUT_MS,
        ...(options.newId ? { newId: options.newId } : {}),
        unavailableMessage: "The chat panel that runs on-device models is closed.",
        detachedMessage: "The engine running this model stopped (the chat panel closed or its worker ended).",
        // Only a webview: a fallback port's worker reports its own death (the lifecycle).
        onProbeTimeout: (port) => {
            const entry = entryOf(port);
            if (entry && !entry.runtimes && !dormant.has(entry)) {
                dormant.add(entry);
                client.drop(port);
            }
        },
        onHeard: (port) => {
            const entry = entryOf(port);
            if (entry)
                dormant.delete(entry);
        },
    });
    const serving = (runtime) => ports.filter((p) => !dormant.has(p) && (!p.runtimes || p.runtimes.includes(runtime)));
    /** Preferred ports first; then webviews (no runtime list), newest first; then the other
     *  fallback ports, newest first. */
    const ranked = (runtime) => {
        const candidates = serving(runtime).reverse();
        const rest = candidates.filter((p) => !p.preferred);
        return [...candidates.filter((p) => p.preferred), ...rest.filter((p) => !p.runtimes), ...rest.filter((p) => p.runtimes)];
    };
    const engines = LOCAL_RUNTIMES.filter((runtime) => runtime.reach === "page" && runtime.defaultBaseUrl).map((runtime) => rankedEngine(client, runtime.id, runtime.defaultBaseUrl, () => ranked(runtime.id)));
    return {
        engines,
        attach(port, attachOptions = {}) {
            const entry = {
                port,
                ...(attachOptions.runtimes ? { runtimes: attachOptions.runtimes } : {}),
                ...(attachOptions.probeTimeoutMs !== undefined ? { probeTimeoutMs: attachOptions.probeTimeoutMs } : {}),
                ...(attachOptions.preferred ? { preferred: true } : {}),
            };
            ports.push(entry);
            return () => {
                const at = ports.indexOf(entry);
                if (at < 0)
                    return;
                ports.splice(at, 1);
                dormant.delete(entry);
                client.drop(port);
            };
        },
        fail: (port) => client.drop(port),
        receive: (message) => client.receive(message),
        connected: (runtime) => (runtime ? serving(runtime).length > 0 : ports.some((p) => !dormant.has(p))),
        probe: (probeOptions) => probePageEngines(engines, probeOptions),
        fetch: (base) => pageEnginesFetch(engines, base),
    };
}
/** THE bridge for this extension host — panels attach to it, routes read it. */
export const hostPageEngines = createHostPageEngineBridge();
//# sourceMappingURL=pageEngineBridge.js.map