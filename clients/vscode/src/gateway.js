import * as vscode from "vscode";
import nodeFs from "node:fs";
import nodeOs from "node:os";
import nodePath from "node:path";
import { gatewayCanChooseModel, gatewayModelIdentity, gatewayPlanModels, NOT_SIGNED_IN } from "@seanhogg/builderforce-brain-embedded";
import { BFI_DISCOVERY_ENV, BFI_DISCOVERY_RELATIVE_PATH, localRuntime, normalizeLocalBaseUrl, parseBfiDiscovery, } from "@builderforce/local-inference";
import { readDesktopModelsEndpoint } from "./desktopContext";
import { isKimiCodeInstall, loadKimiCodeInstall } from "./kimiCodeInstall";
import { localCredentialSnapshot } from "./localProviderCredentials";
import { classifyQueue } from "@builderforce/write-outbox";
import { registerDeadLetterQueue } from "./deadLetterCommand";
import { createDurableOutbox, outboxSecrets, scopeTenantId, trackReachability } from "./outboxStorage";
import { gatewayAuthHeaders, observeGatewayResponse } from "./gatewayAuth";
/** Single source of truth for the SecretStorage key (DRY). */
export const SECRET_KEY = "builderforce.apiKey";
/**
 * Gateway base URL from settings, trailing slashes stripped. Defaults to the
 * primary domain's same-origin gateway path (`builderforce.ai/gateway`) so it
 * reaches the API on corporate networks that whitelist the main site but block
 * the `api.` subdomain. The fallback here matches the manifest default and is
 * only hit if a user explicitly blanks the setting.
 */
export function getBaseUrl() {
    const raw = vscode.workspace.getConfiguration("builderforce").get("baseUrl") ||
        "https://builderforce.ai/gateway";
    return raw.replace(/\/+$/, "");
}
export function getApiKey(secrets) {
    return secrets.get(SECRET_KEY);
}
/**
 * The Kimi Code install, memoized for a short window. Discovery is synchronous disk
 * I/O (config.toml + the credential file), and three readers ask for it per proxied
 * request — the model list, the endpoint authorizer and the picker's unavailable-reason
 * — so an unmemoized read was six file reads per turn. The TOKEN is never taken from
 * this value: `localEndpointAuth.authorizeLocalEndpoint` resolves a fresh one at request time,
 * so the window only ever delays noticing an install/uninstall or a sign-out, and the
 * configuration-change hook drops it early (same pattern as `MODELS_TTL_MS`).
 */
const KIMI_INSTALL_TTL_MS = 30_000;
let kimiInstallMemo;
export function currentKimiInstall() {
    const now = Date.now();
    if (kimiInstallMemo && now - kimiInstallMemo.ts < KIMI_INSTALL_TTL_MS)
        return kimiInstallMemo.value;
    const value = loadKimiCodeInstall(nodeFs, process.env, undefined, now);
    kimiInstallMemo = { ts: now, value };
    return value;
}
/** Drop the memo so the next reader re-discovers the install (settings changed, a
 *  Kimi sign-in/out was just performed here). */
export function invalidateKimiInstallMemo() {
    kimiInstallMemo = undefined;
}
/**
 * Synapse's native engine (`bfi serve`), the third on-device runtime. Unlike Ollama and
 * FreeToken it has no fixed port — it starts at 11434 and walks upward when Ollama holds
 * it — so it is DISCOVERED, the way Kimi Code is:
 *
 *  1. the `builderforce.localModels.synapseUrl` setting, when set (a bfi on another
 *     machine, or a non-default bind);
 *  2. the desktop app's `desktop.json` `models.endpoint` (the app supervises `bfi serve`);
 *  3. bfi's own announcement, `~/.builderforce/bfi.json` — a bare `bfi serve` with no
 *     desktop app.
 *
 * The api key comes from discovery even when the URL comes from the setting, as long as
 * both name the same server: a user who typed the URL should not also have to copy a
 * key out of a file. A machine with none of the three contributes no endpoint.
 */
function resolveSynapseEndpoint(configuredUrl) {
    const discovered = readDesktopModelsEndpoint() ?? readBfiDiscovery();
    const configured = configuredUrl.trim();
    if (!configured)
        return discovered;
    const token = discovered?.token && normalizeLocalBaseUrl(discovered.baseUrl) === normalizeLocalBaseUrl(configured)
        ? discovered.token
        : undefined;
    return { baseUrl: configured, ...(token ? { token } : {}) };
}
/** `~/.builderforce/bfi.json` (or `$BFI_DISCOVERY`), parsed; null when absent/invalid.
 *  Synchronous like `readDesktopModelsEndpoint`, so the config read stays synchronous. */
function readBfiDiscovery() {
    const override = process.env[BFI_DISCOVERY_ENV]?.trim();
    const file = override || nodePath.join(nodeOs.homedir(), ...BFI_DISCOVERY_RELATIVE_PATH.split("/"));
    try {
        return parseBfiDiscovery(JSON.parse(nodeFs.readFileSync(file, "utf8")));
    }
    catch {
        return null;
    }
}
/**
 * The on-device runtime settings (`builderforce.localModels.*`), read HERE with the
 * other configuration accessors so `localModels.ts` stays free of `vscode` and testable
 * in the harness. Single source of truth: every surface that offers or dispatches a
 * local model reads this.
 */
export function getLocalModelsConfig() {
    const cfg = vscode.workspace.getConfiguration("builderforce");
    // Kimi is not configured, it is DISCOVERED — from either of two places, the local CLI
    // first because it costs no round trip:
    //   • the Kimi Code CLI's own login, which wrote the endpoint, the model table and the
    //     credential to disk;
    //   • the WORKSPACE's Kimi connection, whose last issued credential this editor keeps
    //     (endpoint + the tenant's chosen model order; the token is resolved per request).
    // A machine with neither contributes no endpoint and no rows.
    const kimi = kimiSource();
    const synapse = resolveSynapseEndpoint(cfg.get("localModels.synapseUrl") ?? "");
    return {
        enabled: cfg.get("localModels.enabled") === true,
        // Default ON once local inference is enabled: "local first, failover to cloud" is
        // the product behaviour, and an explicit model pick still wins over it.
        localFirst: cfg.get("localModels.localFirst") !== false,
        endpoints: {
            ollama: { baseUrl: cfg.get("localModels.ollamaUrl") || localRuntime("ollama").defaultBaseUrl },
            freetoken: { baseUrl: cfg.get("localModels.freetokenUrl") || localRuntime("freetoken").defaultBaseUrl },
            // Endpoint only — deliberately NO token. Kimi's access tokens last fifteen minutes,
            // so a credential captured into this synchronous config would routinely be stale by
            // the time it was sent; it is resolved instead at the moment of the request by
            // {@link authorizeLocalEndpoint}. The happy side effect is that the credential never
            // sits inside a config object that gets passed around and logged.
            ...(kimi ? { "kimi-code": { baseUrl: kimi.baseUrl } } : {}),
            ...(synapse ? { synapse } : {}),
        },
        ...(kimi ? { kimiCodeModels: kimi.models } : {}),
    };
}
/** Where this machine's Kimi endpoint and models come from right now, or null. */
function kimiSource() {
    const install = currentKimiInstall();
    if (isKimiCodeInstall(install))
        return install;
    const account = localCredentialSnapshot("kimi");
    return account ? { baseUrl: account.baseUrl, models: account.models } : null;
}
/**
 * Why an INSTALLED Kimi Code is not being offered, or null when there is nothing to say.
 *
 * Null covers both "it is working" and "this machine has no Kimi Code at all" — the
 * second deliberately, because the overwhelming majority of users have never installed it
 * and must not be told about a product they do not run. What remains is exactly the
 * confusing case: Kimi Code is sitting right there in the editor and BuilderForce is not
 * offering it. Same argument as the picker's premium-locked row — silently omitting a
 * group makes the picker look broken.
 *
 * Returns the machine `reason` so the CALLER localizes the sentence (this module is the
 * config layer, and `kimiCodeInstall` is deliberately `vscode`-free). `detail` carries
 * credential field NAMES only — never a value — and is shown only where it helps.
 */
export function getKimiCodeUnavailableReason() {
    const kimi = currentKimiInstall();
    if (isKimiCodeInstall(kimi) || kimi.reason === "no_install")
        return null;
    // The workspace's own Kimi connection already serves Kimi here — the CLI's signed-out
    // login is then nothing the person needs to act on.
    if (localCredentialSnapshot("kimi"))
        return null;
    return { reason: kimi.reason, detail: kimi.detail };
}
/**
 * Whether opening a session reuses the single chat tab (switching conversations
 * inside it — the default, and how the panel has always behaved) or gives each
 * session its own tab so the user can switch between them like editor tabs.
 * Single source of truth: everything that branches on tab behaviour reads this.
 */
export function getSessionTabMode() {
    return vscode.workspace.getConfiguration("builderforce").get("sessionTabs") === "perSession"
        ? "perSession"
        : "reuse";
}
/**
 * The BuilderForce web app base URL (where workspace onboarding + embed pages live).
 * Derived from the gateway base by dropping any `api.` host prefix AND the path
 * (so both `https://api.builderforce.ai` and `https://builderforce.ai/gateway`
 * resolve to `https://builderforce.ai`). Overridable via `builderforce.webUrl`.
 * Single source of truth for web deep-links.
 */
export function getWebBaseUrl() {
    const override = vscode.workspace.getConfiguration("builderforce").get("webUrl");
    if (override)
        return override.replace(/\/+$/, "");
    try {
        const u = new URL(getBaseUrl());
        u.hostname = u.hostname.replace(/^api\./, "");
        u.pathname = "";
        u.search = "";
        return u.toString().replace(/\/+$/, "");
    }
    catch {
        return "https://builderforce.ai";
    }
}
/**
 * Models cache. Intentional single-process, in-memory TTL cache: the cross-isolate
 * `getOrSetCached` rule governs the Cloudflare backend; a VS Code extension host is a
 * single Node process serving one user, so a local TTL cache is the correct shape here.
 * `forceRefresh` busts it; the model pool is slow-changing.
 */
let modelsCache;
const MODELS_TTL_MS = 5 * 60_000;
export async function getModels(secrets, forceRefresh = false) {
    if (!forceRefresh && modelsCache && Date.now() - modelsCache.ts < MODELS_TTL_MS) {
        return modelsCache.data;
    }
    const key = await getApiKey(secrets);
    if (!key)
        throw new Error(NOT_SIGNED_IN);
    const headers = gatewayAuthHeaders(key);
    const res = await fetch(`${getBaseUrl()}/llm/v1/models`, {
        headers,
    });
    observeGatewayResponse(res, headers);
    if (!res.ok)
        throw new Error(`models_failed_${res.status}`);
    const json = (await res.json());
    const models = gatewayPlanModels(json);
    // Premium is the whole paid OpenRouter catalog, so it is NOT inlined into
    // /v1/models — it comes from the cached public /v1/catalog. Only fetch it for an
    // entitled tenant; a failure degrades to "no premium" rather than breaking the picker.
    const canUsePremiumModels = json.canUsePremiumModels === true;
    const [premiumModels, configuredModels] = await Promise.all([
        canUsePremiumModels ? getPremiumCatalog().catch(() => []) : Promise.resolve([]),
        getConfiguredModels(secrets).catch(() => []),
    ]);
    // BYO + entitlement flags. Tolerant of an older gateway that omits them: no BYO,
    // and model choice defaults to whatever premium access says (the pre-existing
    // behaviour), so the picker degrades instead of locking the user out.
    const byo = {
        providers: (json.byo?.providers ?? []).filter((p) => typeof p === 'string'),
        models: (json.byo?.models ?? []).filter((m) => !!m && typeof m.id === 'string'),
    };
    const canUseFrontierModels = json.canUseFrontierModels === true;
    // The ONE entitlement rule (brain-embedded `gatewayModels`), older-payload fallback included.
    const canChooseModel = gatewayCanChooseModel(json);
    const data = {
        models,
        freeModels: (json.freeModels ?? []).filter((id) => typeof id === 'string'),
        configuredModels,
        canUsePremiumModels,
        premiumModels,
        canChooseModel,
        canUseFrontierModels,
        byo,
        teacherModels: json.teacherModels ?? [],
        identity: gatewayModelIdentity(json),
        ...(json.premiumInfo ? { premiumInfo: json.premiumInfo } : {}),
    };
    modelsCache = { ts: Date.now(), data };
    return data;
}
/**
 * Would the gateway ACCEPT this pin for this tenant?
 *
 * The single entitlement predicate for a model id, so the picker (which offers
 * models) and model resolution (which sends one) can never disagree. A pin the
 * gateway will reject isn't a degraded experience — it's a hard 402 on every
 * turn, which is exactly how a free-plan user ends up staring at "…require a
 * validated card on file" for a model they don't remember choosing.
 *
 * `undefined` (gateway auto-select) is always allowed — it's the absence of a pin.
 */
export function isModelAllowed(choices, model) {
    if (!model)
        return true;
    // A project-Evermind pin is a plan FEATURE, not a model choice off the catalog:
    // the gateway expands it to the project's own learned head, so it never lands on
    // the premium/frontier gates and stays available on every tier.
    if (model.startsWith("project_evermind:"))
        return true;
    if (!choices.canChooseModel)
        return false;
    if (choices.configuredModels.some((m) => m.ref === model))
        return true;
    if (choices.byo.models.some((m) => m.id === model))
        return true;
    if (choices.models.includes(model))
        return true;
    return choices.canUsePremiumModels && choices.premiumModels.includes(model);
}
async function getConfiguredModels(secrets) {
    // `/api/*` is JWT-only: the session transport sends the selected workspace's token.
    // Lazy: the session module needs a full vscode host at import time.
    const { authed } = await import("./bfApi/transport");
    const json = await authed(secrets, "/api/llm/models", {
        asTenant: "current",
    });
    if (!json)
        throw new Error("configured_models_failed_not_signed_in");
    return (json.models ?? [])
        .filter((model) => typeof model.ref === 'string' && !!model.ref)
        .map((model) => ({ ref: model.ref, name: model.name?.trim() || model.ref }));
}
/**
 * Paid OpenRouter models the plan pool does NOT already route — the premium tier.
 * Mirrors the server's `isPremiumModelSelection`: a model that costs money and carries
 * no `pool` marker. Cheapest-first so the picker's top entries are the affordable ones.
 *
 * TOOL-CAPABLE ONLY: the selected model drives the Brain's tool loop on every editor
 * chat turn, so a premium model that can't call tools would break the surface it was
 * picked for. Same filter the web picker's coding variant applies.
 */
async function getPremiumCatalog() {
    const res = await fetch(`${getBaseUrl()}/llm/v1/catalog`, { headers: { accept: "application/json" } });
    if (!res.ok)
        throw new Error(`catalog_failed_${res.status}`);
    const json = (await res.json());
    return (json.data ?? [])
        .filter((m) => !!m.id && !m.pool &&
        ((m.pricing?.prompt ?? 0) > 0 || (m.pricing?.completion ?? 0) > 0) &&
        (m.supportedParameters?.includes("tools") ?? false))
        .sort((a, b) => ((a.pricing?.prompt ?? 0) + (a.pricing?.completion ?? 0)) -
        ((b.pricing?.prompt ?? 0) + (b.pricing?.completion ?? 0)))
        .map((m) => m.id);
}
/** The `?projectId=` suffix for the insights endpoints when a project is in scope. */
function insightsProjectQuery(projectId) {
    return projectId != null ? `?projectId=${projectId}` : "";
}
/** Fetch the current builder-insights snapshot once (cached server-side). Scoped to
 *  `projectId` when set, else the whole tenant/caller. */
export async function getBuilderInsights(secrets, projectId) {
    const key = await getApiKey(secrets);
    if (!key)
        throw new Error(NOT_SIGNED_IN);
    const headers = gatewayAuthHeaders(key);
    const res = await fetch(`${getBaseUrl()}/llm/v1/builder-insights${insightsProjectQuery(projectId)}`, {
        headers,
    });
    observeGatewayResponse(res, headers);
    if (!res.ok)
        throw new Error(`insights_failed_${res.status}`);
    return (await res.json());
}
/**
 * Subscribe to the builder-insights SSE stream. Invokes `onSnapshot` for each
 * `data:` frame until the stream closes or `signal` aborts. Throws
 * `not_signed_in` when no key, and `insights_stream_failed_<status>` on a bad
 * response so the caller can decide whether to reconnect. Mirrors the SSE
 * frame parser in agent-runtime's native-llm.ts.
 */
export async function streamBuilderInsights(secrets, onSnapshot, signal, projectId) {
    const key = await getApiKey(secrets);
    if (!key)
        throw new Error(NOT_SIGNED_IN);
    const headers = gatewayAuthHeaders(key, { accept: "text/event-stream" });
    const res = await fetch(`${getBaseUrl()}/llm/v1/builder-insights/stream${insightsProjectQuery(projectId)}`, {
        headers,
        signal,
    });
    observeGatewayResponse(res, headers);
    if (!res.ok || !res.body)
        throw new Error(`insights_stream_failed_${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const handleFrame = (frame) => {
        let eventName = "message";
        const dataLines = [];
        for (const line of frame.split("\n")) {
            if (line.startsWith("event:"))
                eventName = line.slice(6).trim();
            else if (line.startsWith("data:"))
                dataLines.push(line.slice(5).trim());
        }
        if (eventName === "error" || dataLines.length === 0)
            return;
        try {
            const snapshot = JSON.parse(dataLines.join("\n"));
            onSnapshot(snapshot);
        }
        catch {
            /* ignore malformed frame */
        }
    };
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            let sep;
            // SSE frames are separated by a blank line.
            while ((sep = buffer.indexOf("\n\n")) !== -1) {
                const frame = buffer.slice(0, sep);
                buffer = buffer.slice(sep + 2);
                if (frame.trim())
                    handleFrame(frame);
            }
        }
    }
    finally {
        try {
            await reader.cancel();
        }
        catch {
            /* already closed */
        }
    }
}
export async function complete(secrets, messages, model, signal, options = {}) {
    const key = await getApiKey(secrets);
    if (!key)
        throw new Error(NOT_SIGNED_IN);
    const body = { messages, stream: false };
    if (model)
        body.model = model;
    if (options.temperature !== undefined)
        body.temperature = options.temperature;
    if (options.maxTokens !== undefined)
        body.max_tokens = options.maxTokens;
    const headers = gatewayAuthHeaders(key, { "content-type": "application/json" });
    const res = await fetch(`${getBaseUrl()}/llm/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
    });
    observeGatewayResponse(res, headers);
    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`complete_failed_${res.status}: ${txt.slice(0, 200)}`);
    }
    const json = (await res.json());
    return json.choices?.[0]?.message?.content ?? "";
}
/**
 * Settled run outcomes waiting to reach learned routing — durable, so a run finished
 * offline still teaches the router once the gateway answers. Replays are safe: the
 * endpoint is idempotent on the outcome's `clientRunId`. A permanent refusal is a dead
 * letter, not a drop: the outcome is user work.
 */
const runOutcomes = createDurableOutbox("run-outcomes", {
    // User work. The queue table leaves "run-outcomes" unclassified (not telemetry);
    // stamp the durable history kind so a permanent refusal is a dead letter, not a drop.
    work: classifyQueue("run-outcomes")?.retention === "best-effort" ? "telemetry" : "history",
    maxItems: 1,
    maxWaitMs: 0,
    send: async (_lane, [outcome], ctx) => {
        const key = await getApiKey(await outboxSecrets());
        if (!key)
            throw new Error("no gateway key");
        const headers = gatewayAuthHeaders(key, { "content-type": "application/json" }, scopeTenantId(ctx.scope));
        const res = await trackReachability(fetch(`${getBaseUrl()}/llm/v1/run-outcome`, {
            method: "POST",
            // The workspace the outcome was QUEUED in, not whichever is selected at send time.
            headers,
            body: JSON.stringify(outcome),
        }));
        observeGatewayResponse(res, headers);
        if (!res.ok)
            throw Object.assign(new Error(`run-outcome → HTTP ${res.status}`), { status: res.status });
    },
    // Scoped to the WORKSPACE it was queued in: it is parked until that workspace is current
    // again, so an outcome queued in one workspace never replays into another.
}, "workspace");
/** The queue this module already owns. Export and repair see this object, not a second outbox. */
registerDeadLetterQueue({ name: "run-outcomes", outbox: runOutcomes });
/**
 * Report a settled run's outcome to learned routing (`POST /llm/v1/run-outcome`, the
 * `RUN_OUTCOME_PATH` of `@builderforce/learned-routing`), so a run in the editor teaches
 * the router which connected model codes best, exactly as a cloud run does. Same gateway
 * credential as a completion. Queued in a durable outbox: resolves at once, never throws,
 * and an outcome that cannot be sent now is sent when the gateway is reachable again,
 * with the credential bound at activation.
 */
export async function postRunOutcome(outcome) {
    runOutcomes.enqueue("run", outcome);
}
//# sourceMappingURL=gateway.js.map