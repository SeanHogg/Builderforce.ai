import { Type } from "@sinclair/typebox";
import { formatCliCommand } from "../../cli/command-format.js";
import type { BuilderForceAgentsConfig } from "../../config/config.js";
import { wrapWebContent } from "../../security/external-content.js";
import { normalizeSecretInput } from "../../utils/normalize-secret-input.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";
import {
  CacheEntry,
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  normalizeCacheKey,
  readCache,
  readResponseText,
  resolveCacheTtlMs,
  resolveTimeoutSeconds,
  withTimeout,
  writeCache,
} from "./web-shared.js";

const SEARCH_PROVIDERS = ["brave", "perplexity", "grok", "keyless"] as const;
const DEFAULT_SEARCH_COUNT = 5;
const MAX_SEARCH_COUNT = 10;

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_PERPLEXITY_BASE_URL = "https://openrouter.ai/api/v1";
const PERPLEXITY_DIRECT_BASE_URL = "https://api.perplexity.ai";
const DEFAULT_PERPLEXITY_MODEL = "perplexity/sonar-pro";
const PERPLEXITY_KEY_PREFIXES = ["pplx-"];
const OPENROUTER_KEY_PREFIXES = ["sk-or-"];

const XAI_API_ENDPOINT = "https://api.x.ai/v1/responses";
const DEFAULT_GROK_MODEL = "grok-4-1-fast";

/**
 * The KEYLESS floor — the fourth provider, and the only one an operator can run
 * with nothing configured.
 *
 * Every other provider here refuses without an API key, which meant a
 * self-hosted gateway researched nothing out of the box while the same
 * company's cloud canvas researched fine. This closes that, but DELIBERATELY
 * behind `tools.web.search.keylessFallback` (default off): the gateway's whole
 * contract is that the operator declares which tools may reach the network and
 * where, so silently adding an outbound Wikipedia call to every unconfigured
 * deployment would change its egress profile without anyone asking.
 *
 * Two backings, in precedence order:
 *   1. A SearXNG instance the OPERATOR runs — real open-web coverage, no vendor
 *      account, no per-query meter, and traffic that leaves only to a host they
 *      already chose. This is the right shape for a self-hosted product.
 *   2. Wikipedia's MediaWiki search API — narrower (encyclopedic, not the open
 *      web) but real, citable, fetchable evidence rather than model recall, and
 *      licence-clean to quote with attribution.
 *
 * This mirrors the platform's own keyless floor (`api/src/application/runtime/
 * webSearchVendors.ts`). The two are NOT merged: that one is multi-tenant and
 * reads a tenant's stored vendor keys, this one is configured per-deployment and
 * has the gateway's freshness filters and in-process cache around it.
 */
const MEDIAWIKI_SEARCH_ENDPOINT = "https://en.wikipedia.org/w/api.php";
const WIKIPEDIA_ATTRIBUTION = "Results from Wikipedia, available under CC BY-SA 4.0";
const SEARXNG_ATTRIBUTION = "Results from a self-hosted SearXNG instance";

const SEARCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();
const BRAVE_FRESHNESS_SHORTCUTS = new Set(["pd", "pw", "pm", "py"]);
const BRAVE_FRESHNESS_RANGE = /^(\d{4}-\d{2}-\d{2})to(\d{4}-\d{2}-\d{2})$/;

const WebSearchSchema = Type.Object({
  query: Type.String({ description: "Search query string." }),
  count: Type.Optional(
    Type.Number({
      description: "Number of results to return (1-10).",
      minimum: 1,
      maximum: MAX_SEARCH_COUNT,
    }),
  ),
  country: Type.Optional(
    Type.String({
      description:
        "2-letter country code for region-specific results (e.g., 'DE', 'US', 'ALL'). Default: 'US'.",
    }),
  ),
  search_lang: Type.Optional(
    Type.String({
      description: "ISO language code for search results (e.g., 'de', 'en', 'fr').",
    }),
  ),
  ui_lang: Type.Optional(
    Type.String({
      description: "ISO language code for UI elements.",
    }),
  ),
  freshness: Type.Optional(
    Type.String({
      description:
        "Filter results by discovery time. Brave supports 'pd', 'pw', 'pm', 'py', and date range 'YYYY-MM-DDtoYYYY-MM-DD'. Perplexity supports 'pd', 'pw', 'pm', and 'py'.",
    }),
  ),
});

type WebSearchConfig = NonNullable<BuilderForceAgentsConfig["tools"]>["web"] extends infer Web
  ? Web extends { search?: infer Search }
    ? Search
    : undefined
  : undefined;

type BraveSearchResult = {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
};

type BraveSearchResponse = {
  web?: {
    results?: BraveSearchResult[];
  };
};

type PerplexityConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

type PerplexityApiKeySource = "config" | "perplexity_env" | "openrouter_env" | "none";

type GrokConfig = {
  apiKey?: string;
  model?: string;
  inlineCitations?: boolean;
};

type GrokSearchResponse = {
  output?: Array<{
    type?: string;
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
      annotations?: Array<{
        type?: string;
        url?: string;
        start_index?: number;
        end_index?: number;
      }>;
    }>;
  }>;
  output_text?: string; // deprecated field - kept for backwards compatibility
  citations?: string[];
  inline_citations?: Array<{
    start_index: number;
    end_index: number;
    url: string;
  }>;
};

type PerplexitySearchResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  citations?: string[];
};

type PerplexityBaseUrlHint = "direct" | "openrouter";

function extractGrokContent(data: GrokSearchResponse): {
  text: string | undefined;
  annotationCitations: string[];
} {
  // xAI Responses API format: find the message output with text content
  for (const output of data.output ?? []) {
    if (output.type !== "message") {
      continue;
    }
    for (const block of output.content ?? []) {
      if (block.type === "output_text" && typeof block.text === "string" && block.text) {
        // Extract url_citation annotations from this content block
        const urls = (block.annotations ?? [])
          .filter((a) => a.type === "url_citation" && typeof a.url === "string")
          .map((a) => a.url as string);
        return { text: block.text, annotationCitations: [...new Set(urls)] };
      }
    }
  }
  // Fallback: deprecated output_text field
  const text = typeof data.output_text === "string" ? data.output_text : undefined;
  return { text, annotationCitations: [] };
}

function resolveSearchConfig(cfg?: BuilderForceAgentsConfig): WebSearchConfig {
  const search = cfg?.tools?.web?.search;
  if (!search || typeof search !== "object") {
    return undefined;
  }
  return search as WebSearchConfig;
}

function resolveSearchEnabled(params: { search?: WebSearchConfig; sandboxed?: boolean }): boolean {
  if (typeof params.search?.enabled === "boolean") {
    return params.search.enabled;
  }
  if (params.sandboxed) {
    return true;
  }
  return true;
}

function resolveSearchApiKey(search?: WebSearchConfig): string | undefined {
  const fromConfig =
    search && "apiKey" in search && typeof search.apiKey === "string"
      ? normalizeSecretInput(search.apiKey)
      : "";
  const fromEnv = normalizeSecretInput(process.env.BRAVE_API_KEY);
  return fromConfig || fromEnv || undefined;
}

type KeylessConfig = { searxngUrl?: string };

function resolveKeylessConfig(search?: WebSearchConfig): KeylessConfig {
  const raw = search && typeof search === "object" && "keyless" in search ? search.keyless : undefined;
  const fromConfig =
    raw && typeof raw === "object" && "searxngUrl" in raw && typeof raw.searxngUrl === "string"
      ? raw.searxngUrl.trim()
      : "";
  const fromEnv = (process.env.SEARXNG_URL ?? "").trim();
  const searxngUrl = fromConfig || fromEnv;
  return searxngUrl ? { searxngUrl } : {};
}

/** Whether an unkeyed search may fall back to the keyless adapter. OFF unless the
 *  operator said so, because it is an egress decision and not a default. */
function resolveKeylessFallback(search?: WebSearchConfig): boolean {
  return !!(
    search &&
    typeof search === "object" &&
    "keylessFallback" in search &&
    search.keylessFallback === true
  );
}

function missingSearchKeyPayload(provider: (typeof SEARCH_PROVIDERS)[number]) {
  if (provider === "perplexity") {
    return {
      error: "missing_perplexity_api_key",
      message:
        "web_search (perplexity) needs an API key. Set PERPLEXITY_API_KEY or OPENROUTER_API_KEY in the Gateway environment, or configure tools.web.search.perplexity.apiKey.",
      docs: "https://docs.builderforce.ai/tools/web",
    };
  }
  if (provider === "grok") {
    return {
      error: "missing_xai_api_key",
      message:
        "web_search (grok) needs an xAI API key. Set XAI_API_KEY in the Gateway environment, or configure tools.web.search.grok.apiKey.",
      docs: "https://docs.builderforce.ai/tools/web",
    };
  }
  return {
    error: "missing_brave_api_key",
    // The keyless option is named here rather than applied silently: a search
    // that reaches the network from a deployment the operator believed was
    // offline is a worse failure than a search that refuses and says why.
    message: `web_search needs a Brave Search API key. Run \`${formatCliCommand("builderforce configure --section web")}\` to store it, or set BRAVE_API_KEY in the Gateway environment. To search with no key at all, set tools.web.search.keylessFallback: true (and optionally tools.web.search.keyless.searxngUrl to point at your own SearXNG).`,
    docs: "https://docs.builderforce.ai/tools/web",
  };
}

function resolveSearchProvider(search?: WebSearchConfig): (typeof SEARCH_PROVIDERS)[number] {
  const raw =
    search && "provider" in search && typeof search.provider === "string"
      ? search.provider.trim().toLowerCase()
      : "";
  if (raw === "perplexity") {
    return "perplexity";
  }
  if (raw === "grok") {
    return "grok";
  }
  if (raw === "brave") {
    return "brave";
  }
  if (raw === "keyless") {
    return "keyless";
  }
  return "brave";
}

function resolvePerplexityConfig(search?: WebSearchConfig): PerplexityConfig {
  if (!search || typeof search !== "object") {
    return {};
  }
  const perplexity = "perplexity" in search ? search.perplexity : undefined;
  if (!perplexity || typeof perplexity !== "object") {
    return {};
  }
  return perplexity as PerplexityConfig;
}

function resolvePerplexityApiKey(perplexity?: PerplexityConfig): {
  apiKey?: string;
  source: PerplexityApiKeySource;
} {
  const fromConfig = normalizeApiKey(perplexity?.apiKey);
  if (fromConfig) {
    return { apiKey: fromConfig, source: "config" };
  }

  const fromEnvPerplexity = normalizeApiKey(process.env.PERPLEXITY_API_KEY);
  if (fromEnvPerplexity) {
    return { apiKey: fromEnvPerplexity, source: "perplexity_env" };
  }

  const fromEnvOpenRouter = normalizeApiKey(process.env.OPENROUTER_API_KEY);
  if (fromEnvOpenRouter) {
    return { apiKey: fromEnvOpenRouter, source: "openrouter_env" };
  }

  return { apiKey: undefined, source: "none" };
}

function normalizeApiKey(key: unknown): string {
  return normalizeSecretInput(key);
}

function inferPerplexityBaseUrlFromApiKey(apiKey?: string): PerplexityBaseUrlHint | undefined {
  if (!apiKey) {
    return undefined;
  }
  const normalized = apiKey.toLowerCase();
  if (PERPLEXITY_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return "direct";
  }
  if (OPENROUTER_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return "openrouter";
  }
  return undefined;
}

function resolvePerplexityBaseUrl(
  perplexity?: PerplexityConfig,
  apiKeySource: PerplexityApiKeySource = "none",
  apiKey?: string,
): string {
  const fromConfig =
    perplexity && "baseUrl" in perplexity && typeof perplexity.baseUrl === "string"
      ? perplexity.baseUrl.trim()
      : "";
  if (fromConfig) {
    return fromConfig;
  }
  if (apiKeySource === "perplexity_env") {
    return PERPLEXITY_DIRECT_BASE_URL;
  }
  if (apiKeySource === "openrouter_env") {
    return DEFAULT_PERPLEXITY_BASE_URL;
  }
  if (apiKeySource === "config") {
    const inferred = inferPerplexityBaseUrlFromApiKey(apiKey);
    if (inferred === "direct") {
      return PERPLEXITY_DIRECT_BASE_URL;
    }
    if (inferred === "openrouter") {
      return DEFAULT_PERPLEXITY_BASE_URL;
    }
  }
  return DEFAULT_PERPLEXITY_BASE_URL;
}

function resolvePerplexityModel(perplexity?: PerplexityConfig): string {
  const fromConfig =
    perplexity && "model" in perplexity && typeof perplexity.model === "string"
      ? perplexity.model.trim()
      : "";
  return fromConfig || DEFAULT_PERPLEXITY_MODEL;
}

function isDirectPerplexityBaseUrl(baseUrl: string): boolean {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return false;
  }
  try {
    return new URL(trimmed).hostname.toLowerCase() === "api.perplexity.ai";
  } catch {
    return false;
  }
}

function resolvePerplexityRequestModel(baseUrl: string, model: string): string {
  if (!isDirectPerplexityBaseUrl(baseUrl)) {
    return model;
  }
  return model.startsWith("perplexity/") ? model.slice("perplexity/".length) : model;
}

function resolveGrokConfig(search?: WebSearchConfig): GrokConfig {
  if (!search || typeof search !== "object") {
    return {};
  }
  const grok = "grok" in search ? search.grok : undefined;
  if (!grok || typeof grok !== "object") {
    return {};
  }
  return grok as GrokConfig;
}

function resolveGrokApiKey(grok?: GrokConfig): string | undefined {
  const fromConfig = normalizeApiKey(grok?.apiKey);
  if (fromConfig) {
    return fromConfig;
  }
  const fromEnv = normalizeApiKey(process.env.XAI_API_KEY);
  return fromEnv || undefined;
}

function resolveGrokModel(grok?: GrokConfig): string {
  const fromConfig =
    grok && "model" in grok && typeof grok.model === "string" ? grok.model.trim() : "";
  return fromConfig || DEFAULT_GROK_MODEL;
}

function resolveGrokInlineCitations(grok?: GrokConfig): boolean {
  return grok?.inlineCitations === true;
}

function resolveSearchCount(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const clamped = Math.max(1, Math.min(MAX_SEARCH_COUNT, Math.floor(parsed)));
  return clamped;
}

function normalizeFreshness(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const lower = trimmed.toLowerCase();
  if (BRAVE_FRESHNESS_SHORTCUTS.has(lower)) {
    return lower;
  }

  const match = trimmed.match(BRAVE_FRESHNESS_RANGE);
  if (!match) {
    return undefined;
  }

  const [, start, end] = match;
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) {
    return undefined;
  }
  if (start > end) {
    return undefined;
  }

  return `${start}to${end}`;
}

/**
 * Map normalized freshness values (pd/pw/pm/py) to Perplexity's
 * search_recency_filter values (day/week/month/year).
 */
function freshnessToPerplexityRecency(freshness: string | undefined): string | undefined {
  if (!freshness) {
    return undefined;
  }
  const map: Record<string, string> = {
    pd: "day",
    pw: "week",
    pm: "month",
    py: "year",
  };
  return map[freshness] ?? undefined;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function resolveSiteName(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

async function runPerplexitySearch(params: {
  query: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutSeconds: number;
  freshness?: string;
}): Promise<{ content: string; citations: string[] }> {
  const baseUrl = params.baseUrl.trim().replace(/\/$/, "");
  const endpoint = `${baseUrl}/chat/completions`;
  const model = resolvePerplexityRequestModel(baseUrl, params.model);

  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: "user",
        content: params.query,
      },
    ],
  };

  const recencyFilter = freshnessToPerplexityRecency(params.freshness);
  if (recencyFilter) {
    body.search_recency_filter = recencyFilter;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
      "HTTP-Referer": "https://builderforce.ai",
      "X-Title": "BuilderForceAgents Web Search",
    },
    body: JSON.stringify(body),
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!res.ok) {
    const detailResult = await readResponseText(res, { maxBytes: 64_000 });
    const detail = detailResult.text;
    throw new Error(`Perplexity API error (${res.status}): ${detail || res.statusText}`);
  }

  const data = (await res.json()) as PerplexitySearchResponse;
  const content = data.choices?.[0]?.message?.content ?? "No response";
  const citations = data.citations ?? [];

  return { content, citations };
}

async function runGrokSearch(params: {
  query: string;
  apiKey: string;
  model: string;
  timeoutSeconds: number;
  inlineCitations: boolean;
}): Promise<{
  content: string;
  citations: string[];
  inlineCitations?: GrokSearchResponse["inline_citations"];
}> {
  const body: Record<string, unknown> = {
    model: params.model,
    input: [
      {
        role: "user",
        content: params.query,
      },
    ],
    tools: [{ type: "web_search" }],
  };

  // Note: xAI's /v1/responses endpoint does not support the `include`
  // parameter (returns 400 "Argument not supported: include"). Inline
  // citations are returned automatically when available — we just parse
  // them from the response without requesting them explicitly (#12910).

  const res = await fetch(XAI_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!res.ok) {
    const detailResult = await readResponseText(res, { maxBytes: 64_000 });
    const detail = detailResult.text;
    throw new Error(`xAI API error (${res.status}): ${detail || res.statusText}`);
  }

  const data = (await res.json()) as GrokSearchResponse;
  const { text: extractedText, annotationCitations } = extractGrokContent(data);
  const content = extractedText ?? "No response";
  // Prefer top-level citations; fall back to annotation-derived ones
  const citations = (data.citations ?? []).length > 0 ? data.citations! : annotationCitations;
  const inlineCitations = data.inline_citations;

  return { content, citations, inlineCitations };
}

type KeylessRow = { title: string; url: string; description: string; siteName: string | undefined };

/** Drop anything that is not an http(s) address the agent could actually fetch.
 *  Result URLs come from an untrusted index and the model will very likely
 *  `web_fetch` one, so a poisoned entry must not become a lead it follows into a
 *  private network. */
function keepPublicHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return undefined;
  }
  if (/^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)) return undefined;
  if (host === "::1") return undefined;
  return parsed.toString();
}

/** Strip the `<span class="searchmatch">` markup MediaWiki puts in snippets. */
function stripHtml(value: unknown): string {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, "").trim() : "";
}

async function fetchKeylessJson(url: string, timeoutSeconds: number, label: string): Promise<unknown> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      // An honest agent identifies itself; Wikipedia's API asks for it explicitly.
      "User-Agent": "BuilderForceAgents/1.0 (+https://builderforce.ai)",
    },
    signal: withTimeout(undefined, timeoutSeconds * 1000),
  });
  if (!res.ok) {
    const detailResult = await readResponseText(res, { maxBytes: 64_000 });
    const hint =
      label === "SearXNG" && res.status === 403
        ? " — the instance is refusing API requests; enable `formats: [json]` in its settings.yml"
        : "";
    throw new Error(`${label} error (${res.status})${hint}: ${detailResult.text || res.statusText}`);
  }
  return res.json();
}

async function runSearxngSearch(params: {
  query: string;
  count: number;
  baseUrl: string;
  timeoutSeconds: number;
}): Promise<KeylessRow[]> {
  const base = params.baseUrl.replace(/\/+$/, "");
  const search = new URLSearchParams({ q: params.query, format: "json" });
  const json = (await fetchKeylessJson(
    `${base}/search?${search.toString()}`,
    params.timeoutSeconds,
    "SearXNG",
  )) as { results?: unknown };
  const rows = Array.isArray(json.results) ? json.results : [];
  return rows
    .map((raw) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      const url = keepPublicHttpUrl(row.url);
      if (!url) return null;
      return {
        title: typeof row.title === "string" ? row.title : "",
        url,
        description: typeof row.content === "string" ? row.content : "",
        siteName: resolveSiteName(url) || undefined,
      };
    })
    .filter((row): row is KeylessRow => row !== null)
    .slice(0, params.count);
}

async function runWikipediaSearch(params: {
  query: string;
  count: number;
  timeoutSeconds: number;
}): Promise<KeylessRow[]> {
  const search = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: params.query,
    srlimit: String(params.count),
    format: "json",
    origin: "*",
  });
  const json = (await fetchKeylessJson(
    `${MEDIAWIKI_SEARCH_ENDPOINT}?${search.toString()}`,
    params.timeoutSeconds,
    "Wikipedia",
  )) as { query?: { search?: unknown } };
  const rows = Array.isArray(json.query?.search) ? (json.query?.search ?? []) : [];
  return rows
    .map((raw) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      const title = typeof row.title === "string" ? row.title.trim() : "";
      if (!title) return null;
      // MediaWiki returns titles, not links; the URL is DERIVED and still goes
      // through the same egress check, because "we built this one ourselves" is
      // an assumption and this is the assumption that feeds `web_fetch`.
      const url = keepPublicHttpUrl(`https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`);
      if (!url) return null;
      return { title, url, description: stripHtml(row.snippet), siteName: "en.wikipedia.org" as string | undefined };
    })
    .filter((row): row is KeylessRow => row !== null)
    .slice(0, params.count);
}

async function runWebSearch(params: {
  query: string;
  count: number;
  apiKey: string;
  timeoutSeconds: number;
  cacheTtlMs: number;
  provider: (typeof SEARCH_PROVIDERS)[number];
  country?: string;
  search_lang?: string;
  ui_lang?: string;
  freshness?: string;
  perplexityBaseUrl?: string;
  perplexityModel?: string;
  grokModel?: string;
  grokInlineCitations?: boolean;
  keylessSearxngUrl?: string;
}): Promise<Record<string, unknown>> {
  const cacheKey = normalizeCacheKey(
    params.provider === "brave"
      ? `${params.provider}:${params.query}:${params.count}:${params.country || "default"}:${params.search_lang || "default"}:${params.ui_lang || "default"}:${params.freshness || "default"}`
      : params.provider === "perplexity"
        ? `${params.provider}:${params.query}:${params.perplexityBaseUrl ?? DEFAULT_PERPLEXITY_BASE_URL}:${params.perplexityModel ?? DEFAULT_PERPLEXITY_MODEL}:${params.freshness || "default"}`
        : params.provider === "keyless"
          ? `${params.provider}:${params.query}:${params.count}:${params.keylessSearxngUrl ?? "wikipedia"}`
          : `${params.provider}:${params.query}:${params.grokModel ?? DEFAULT_GROK_MODEL}:${String(params.grokInlineCitations ?? false)}`,
  );
  const cached = readCache(SEARCH_CACHE, cacheKey);
  if (cached) {
    return { ...cached.value, cached: true };
  }

  const start = Date.now();

  if (params.provider === "perplexity") {
    const { content, citations } = await runPerplexitySearch({
      query: params.query,
      apiKey: params.apiKey,
      baseUrl: params.perplexityBaseUrl ?? DEFAULT_PERPLEXITY_BASE_URL,
      model: params.perplexityModel ?? DEFAULT_PERPLEXITY_MODEL,
      timeoutSeconds: params.timeoutSeconds,
      freshness: params.freshness,
    });

    const payload = {
      query: params.query,
      provider: params.provider,
      model: params.perplexityModel ?? DEFAULT_PERPLEXITY_MODEL,
      tookMs: Date.now() - start,
      externalContent: {
        untrusted: true,
        source: "web_search",
        provider: params.provider,
        wrapped: true,
      },
      content: wrapWebContent(content),
      citations,
    };
    writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
    return payload;
  }

  if (params.provider === "grok") {
    const { content, citations, inlineCitations } = await runGrokSearch({
      query: params.query,
      apiKey: params.apiKey,
      model: params.grokModel ?? DEFAULT_GROK_MODEL,
      timeoutSeconds: params.timeoutSeconds,
      inlineCitations: params.grokInlineCitations ?? false,
    });

    const payload = {
      query: params.query,
      provider: params.provider,
      model: params.grokModel ?? DEFAULT_GROK_MODEL,
      tookMs: Date.now() - start,
      externalContent: {
        untrusted: true,
        source: "web_search",
        provider: params.provider,
        wrapped: true,
      },
      content: wrapWebContent(content),
      citations,
      inlineCitations,
    };
    writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
    return payload;
  }

  if (params.provider === "keyless") {
    // The operator's own instance first; Wikipedia is the floor beneath it. A
    // SearXNG that is down or misconfigured must not mean no research at all,
    // so its failure degrades to the encyclopedic index rather than throwing.
    let rows: KeylessRow[] = [];
    let backing: "searxng" | "wikipedia" = "wikipedia";
    let degradedFrom: string | undefined;
    if (params.keylessSearxngUrl) {
      try {
        rows = await runSearxngSearch({
          query: params.query,
          count: params.count,
          baseUrl: params.keylessSearxngUrl,
          timeoutSeconds: params.timeoutSeconds,
        });
        backing = "searxng";
      } catch (error) {
        degradedFrom = error instanceof Error ? error.message : String(error);
      }
    }
    if (rows.length === 0) {
      rows = await runWikipediaSearch({
        query: params.query,
        count: params.count,
        timeoutSeconds: params.timeoutSeconds,
      });
      backing = "wikipedia";
    }

    const payload = {
      query: params.query,
      provider: params.provider,
      backing,
      // Named honestly so the answering surface can say what KIND of index
      // backed the research, rather than implying open-web coverage it did not
      // have. This is the same flag the platform's keyless floor carries.
      coverage: backing === "searxng" ? "web" : "encyclopedic",
      attribution: backing === "searxng" ? SEARXNG_ATTRIBUTION : WIKIPEDIA_ATTRIBUTION,
      ...(degradedFrom ? { degradedFrom } : {}),
      count: rows.length,
      tookMs: Date.now() - start,
      externalContent: {
        untrusted: true,
        source: "web_search",
        provider: params.provider,
        wrapped: true,
      },
      results: rows.map((row) => ({
        title: row.title ? wrapWebContent(row.title, "web_search") : "",
        url: row.url, // Keep raw for tool chaining
        description: row.description ? wrapWebContent(row.description, "web_search") : "",
        siteName: row.siteName,
      })),
    };
    writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
    return payload;
  }

  if (params.provider !== "brave") {
    throw new Error("Unsupported web search provider.");
  }

  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set("q", params.query);
  url.searchParams.set("count", String(params.count));
  if (params.country) {
    url.searchParams.set("country", params.country);
  }
  if (params.search_lang) {
    url.searchParams.set("search_lang", params.search_lang);
  }
  if (params.ui_lang) {
    url.searchParams.set("ui_lang", params.ui_lang);
  }
  if (params.freshness) {
    url.searchParams.set("freshness", params.freshness);
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": params.apiKey,
    },
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!res.ok) {
    const detailResult = await readResponseText(res, { maxBytes: 64_000 });
    const detail = detailResult.text;
    throw new Error(`Brave Search API error (${res.status}): ${detail || res.statusText}`);
  }

  const data = (await res.json()) as BraveSearchResponse;
  const results = Array.isArray(data.web?.results) ? (data.web?.results ?? []) : [];
  const mapped = results.map((entry) => {
    const description = entry.description ?? "";
    const title = entry.title ?? "";
    const url = entry.url ?? "";
    const rawSiteName = resolveSiteName(url);
    return {
      title: title ? wrapWebContent(title, "web_search") : "",
      url, // Keep raw for tool chaining
      description: description ? wrapWebContent(description, "web_search") : "",
      published: entry.age || undefined,
      siteName: rawSiteName || undefined,
    };
  });

  const payload = {
    query: params.query,
    provider: params.provider,
    count: mapped.length,
    tookMs: Date.now() - start,
    externalContent: {
      untrusted: true,
      source: "web_search",
      provider: params.provider,
      wrapped: true,
    },
    results: mapped,
  };
  writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
  return payload;
}

/** The web-search backing resolved once from config — provider + per-provider auth
 *  config. Shared by the pi-free `web_search` tool and the Node CapabilityProvider's
 *  `web.search` (PRD 11 §5.2) so both run the SAME backend (DRY). */
interface ResolvedSearchBackend {
  search: WebSearchConfig;
  provider: (typeof SEARCH_PROVIDERS)[number];
  perplexityConfig: PerplexityConfig;
  grokConfig: GrokConfig;
  keylessConfig: KeylessConfig;
  /** Whether an unkeyed provider may degrade to the keyless adapter. */
  keylessFallback: boolean;
}

function resolveSearchBackend(config?: BuilderForceAgentsConfig): ResolvedSearchBackend {
  const search = resolveSearchConfig(config);
  return {
    search,
    provider: resolveSearchProvider(search),
    perplexityConfig: resolvePerplexityConfig(search),
    grokConfig: resolveGrokConfig(search),
    keylessConfig: resolveKeylessConfig(search),
    keylessFallback: resolveKeylessFallback(search),
  };
}

/**
 * Run one web search against the resolved backend, returning the raw payload (the
 * same object the `web_search` tool serializes). Carries an `{ error, message }`
 * payload for a missing key / invalid argument instead of throwing — callers decide
 * how to surface it. The single implementation behind both surfaces.
 */
async function executeWebSearch(
  backend: ResolvedSearchBackend,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { search, perplexityConfig, grokConfig, keylessConfig, keylessFallback } = backend;
  const perplexityAuth =
    backend.provider === "perplexity" ? resolvePerplexityApiKey(perplexityConfig) : undefined;
  const apiKey =
    backend.provider === "perplexity"
      ? perplexityAuth?.apiKey
      : backend.provider === "grok"
        ? resolveGrokApiKey(grokConfig)
        : backend.provider === "keyless"
          ? "keyless"
          : resolveSearchApiKey(search);

  // The one place the keyless floor engages: a provider with no key, and an
  // operator who explicitly allowed the fallback. Without the flag this is still
  // an honest refusal that names the option.
  const provider: (typeof SEARCH_PROVIDERS)[number] =
    !apiKey && keylessFallback ? "keyless" : backend.provider;
  if (!apiKey && provider !== "keyless") {
    return missingSearchKeyPayload(backend.provider);
  }
  const query = readStringParam(params, "query", { required: true });
  const count =
    readNumberParam(params, "count", { integer: true }) ?? search?.maxResults ?? undefined;
  const country = readStringParam(params, "country");
  const search_lang = readStringParam(params, "search_lang");
  const ui_lang = readStringParam(params, "ui_lang");
  const rawFreshness = readStringParam(params, "freshness");
  if (rawFreshness && provider !== "brave" && provider !== "perplexity") {
    return {
      error: "unsupported_freshness",
      message: "freshness is only supported by the Brave and Perplexity web_search providers.",
      docs: "https://docs.builderforce.ai/tools/web",
    };
  }
  const freshness = rawFreshness ? normalizeFreshness(rawFreshness) : undefined;
  if (rawFreshness && !freshness) {
    return {
      error: "invalid_freshness",
      message: "freshness must be one of pd, pw, pm, py, or a range like YYYY-MM-DDtoYYYY-MM-DD.",
      docs: "https://docs.builderforce.ai/tools/web",
    };
  }
  return runWebSearch({
    query,
    count: resolveSearchCount(count, DEFAULT_SEARCH_COUNT),
    apiKey: apiKey ?? "",
    timeoutSeconds: resolveTimeoutSeconds(search?.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS),
    cacheTtlMs: resolveCacheTtlMs(search?.cacheTtlMinutes, DEFAULT_CACHE_TTL_MINUTES),
    provider,
    country,
    search_lang,
    ui_lang,
    freshness,
    perplexityBaseUrl: resolvePerplexityBaseUrl(
      perplexityConfig,
      perplexityAuth?.source,
      perplexityAuth?.apiKey,
    ),
    perplexityModel: resolvePerplexityModel(perplexityConfig),
    grokModel: resolveGrokModel(grokConfig),
    grokInlineCitations: resolveGrokInlineCitations(grokConfig),
    ...(keylessConfig.searxngUrl ? { keylessSearxngUrl: keylessConfig.searxngUrl } : {}),
  });
}

export function createWebSearchTool(options?: {
  config?: BuilderForceAgentsConfig;
  sandboxed?: boolean;
}): AnyAgentTool | null {
  const backend = resolveSearchBackend(options?.config);
  if (!resolveSearchEnabled({ search: backend.search, sandboxed: options?.sandboxed })) {
    return null;
  }

  const { provider } = backend;
  const description =
    provider === "perplexity"
      ? "Search the web using Perplexity Sonar (direct or via OpenRouter). Returns AI-synthesized answers with citations from real-time web search."
      : provider === "grok"
        ? "Search the web using xAI Grok. Returns AI-synthesized answers with citations from real-time web search."
        : provider === "keyless"
          ? "Search the web with no API key, via this deployment's own SearXNG instance when one is configured and Wikipedia otherwise. Returns titles, URLs and snippets."
          : "Search the web using Brave Search API. Supports region-specific and localized search via country and language parameters. Returns titles, URLs, and snippets for fast research.";

  return {
    label: "Web Search",
    name: "web_search",
    description,
    parameters: WebSearchSchema,
    execute: async (_toolCallId, args) => {
      return jsonResult(await executeWebSearch(backend, args as Record<string, unknown>));
    },
  };
}

export const __testing = {
  resolveKeylessConfig,
  resolveKeylessFallback,
  resolveSearchProvider,
  keepPublicHttpUrl,
  runSearxngSearch,
  runWikipediaSearch,
  executeWebSearch,
  resolveSearchBackend,
  inferPerplexityBaseUrlFromApiKey,
  resolvePerplexityBaseUrl,
  isDirectPerplexityBaseUrl,
  resolvePerplexityRequestModel,
  normalizeFreshness,
  freshnessToPerplexityRecency,
  resolveGrokApiKey,
  resolveGrokModel,
  resolveGrokInlineCitations,
  extractGrokContent,
} as const;
