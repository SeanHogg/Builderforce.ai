/**
 * The runtime REGISTRY — every runtime a client on the user's machine can drive
 * directly, as data.
 *
 * Membership means "the CLIENT performs this call itself", not "the weights are on this
 * disk". Six entries are on-device engines (Synapse's native `bfi`, Ollama, FreeToken,
 * and three engines inside the page: our `bfi` compiled to WebAssembly over WebGPU,
 * WebLLM, and the browser's own built-in model): no account, no metering, available
 * offline, and the only ones local-first routing will try. `kimi-code` is Kimi's hosted API and belongs here anyway: its edge
 * refuses a hosted gateway before reading a credential, while the identical request
 * from the developer's own machine is the personal client the subscription is licensed
 * for. Same mechanism, different reason — hence `onDevice`.
 *
 * Kept as DATA so a host never branches on a runtime id: the picker, the probe, the
 * plan and the catalog binding all read the fields below.
 */
type LocalRuntimeId = 'synapse' | 'ollama' | 'freetoken' | 'bfi' | 'webllm' | 'browser' | 'kimi-code';
/**
 * Where a runtime's calls go, and what (if anything) authenticates them. An on-device
 * engine normally leaves `token` unset; `bfi serve --api-key` and a signed-in Kimi
 * install carry one. Callers never branch on which — they pass the endpoint through.
 */
interface LocalEndpoint {
    /** Runtime root (unnormalized is fine — every consumer normalizes). */
    baseUrl: string;
    /** Bearer credential, when this runtime needs one. */
    token?: string;
    /**
     * A bearer that outlives no run — a fifteen-minute Kimi token — asked for afresh before
     * every request (`fetchLocal`), so a long run never sends one that expired mid-way.
     * `rejected` is the token the provider just answered 401 to: drop it and get another,
     * or null when there is none better.
     */
    credential?: (rejected?: string) => Promise<string | null>;
}

/**
 * What the runtimes on this machine serve RIGHT NOW, and what each model can do.
 *
 * A runtime that is not running is the NORMAL case — a developer with only Ollama still
 * opens the picker — so every failure (refused, wedged, non-OK, malformed) reads as "no
 * models" and the probe never throws. A short timeout keeps a wrong-port endpoint from
 * stalling the caller: this is localhost, where a healthy answer is immediate.
 *
 * `fetch` is injected, never the global: the same probe runs in the editor's Node host,
 * a web page and an MV3 service worker, and a test pins it without patching globals.
 */

/** One model a runtime serves. */
interface LocalModel {
    /** The full `local/<runtime>/<model>` ref. */
    ref: string;
    /** The runtime serving it (named `provider` because every stored ref and picker row
     *  already says so). */
    provider: LocalRuntimeId;
    /** The bare id the runtime itself knows, e.g. `qwen3:8b`. */
    model: string;
    /** The runtime's own human label, when it publishes one (Kimi declares "K2.7 Coding");
     *  a picker falls back to the id. */
    label?: string;
    /** May take a TOOL turn. Absent/false = no — see `LocalToolSupport`: unknown is never
     *  read as capable. */
    tools?: boolean;
    /** Context window in tokens, when the runtime reports one. Absent = unknown. */
    contextTokens?: number;
}
/** One runtime's answer. */
interface LocalRuntimeProbe {
    provider: LocalRuntimeId;
    endpoint: LocalEndpoint;
    /** Its catalog route answered OK. False = not running / wrong port / refused. */
    reachable: boolean;
    models: LocalModel[];
}

export type { LocalRuntimeId as L, LocalRuntimeProbe as a, LocalEndpoint as b, LocalModel as c };
