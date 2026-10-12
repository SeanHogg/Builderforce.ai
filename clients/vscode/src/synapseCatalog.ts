/**
 * Synapse catalog and pull — host-owned, never via the chat transport.
 *
 * Chat (`localTransport` / `resolveLocalChatEndpoint`) only ever talks to
 * `/v1/chat/completions`. Catalog lives on `GET /v1/synapse/catalog`; pull on
 * `POST /api/pull`. Both are separate fetches so a webview `llm.fetch` cannot
 * be steered onto the management surface. A 404 catalog is "unavailable", not
 * a fake empty success.
 */
import { normalizeLocalBaseUrl, type LocalEndpoint } from "./localModels";

export function synapseCatalogUrl(baseUrl: string): string {
  return `${normalizeLocalBaseUrl(baseUrl)}/v1/synapse/catalog`;
}

export function synapsePullUrl(baseUrl: string): string {
  return `${normalizeLocalBaseUrl(baseUrl)}/api/pull`;
}

export interface SynapseCatalogItem {
  id: string;
  bytes?: number;
  /** Whether this machine has room for the weights (`fit` from the catalog). */
  fit?: boolean;
}

export type SynapseCatalogResult =
  | { ok: true; items: SynapseCatalogItem[] }
  | { ok: false; reason: "missing" | "unreachable" | "http"; status?: number; detail: string };

export type SynapsePullProgress = {
  status: string;
  completed?: number;
  total?: number;
};

export type SynapsePullResult = { ok: true } | { ok: false; detail: string };

function authHeaders(token?: string): Record<string, string> {
  return {
    accept: "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function parseCatalogItems(json: unknown): SynapseCatalogItem[] {
  if (json == null) return [];
  const rec = typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  const raw = Array.isArray(json)
    ? json
    : Array.isArray(rec?.data)
      ? rec.data
      : Array.isArray(rec?.models)
        ? rec.models
        : [];
  const items: SynapseCatalogItem[] = [];
  for (const row of raw) {
    if (typeof row === "string" && row.trim()) {
      items.push({ id: row.trim() });
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id =
      typeof o.id === "string"
        ? o.id
        : typeof o.name === "string"
          ? o.name
          : typeof o.model === "string"
            ? o.model
            : "";
    if (!id.trim()) continue;
    const size =
      typeof o.bytes === "number"
        ? o.bytes
        : typeof o.size === "number"
          ? o.size
          : undefined;
    const fit = typeof o.fit === "boolean" ? o.fit : undefined;
    items.push({
      id: id.trim(),
      ...(size != null ? { bytes: size } : {}),
      ...(fit != null ? { fit } : {}),
    });
  }
  return items;
}

export async function fetchSynapseCatalog(
  endpoint: LocalEndpoint,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 4_000,
): Promise<SynapseCatalogResult> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetchImpl(synapseCatalogUrl(endpoint.baseUrl), {
      headers: authHeaders(endpoint.token),
      signal: abort.signal,
    });
    if (res.status === 404) {
      return { ok: false, reason: "missing", status: 404, detail: "catalog endpoint is not available" };
    }
    if (!res.ok) {
      return { ok: false, reason: "http", status: res.status, detail: `catalog returned ${res.status}` };
    }
    const json = await res.json().catch(() => null);
    return { ok: true, items: parseCatalogItems(json) };
  } catch (e) {
    return { ok: false, reason: "unreachable", detail: (e as Error).message || "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/** One NDJSON / JSON pull event. `null` for a blank or non-JSON line. */
export function parsePullEvent(
  line: string,
): SynapsePullProgress | { done: true } | { error: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const status = typeof o.status === "string" ? o.status.toLowerCase() : "";
  if (status === "success" || status === "done" || o.done === true) return { done: true };
  if (status === "error" || typeof o.error === "string") {
    return { error: typeof o.error === "string" ? o.error : status || "pull failed" };
  }
  return {
    status: typeof o.status === "string" ? o.status : "pulling",
    completed: typeof o.completed === "number" ? o.completed : undefined,
    total: typeof o.total === "number" ? o.total : undefined,
  };
}

export async function pullSynapseModel(
  endpoint: LocalEndpoint,
  model: string,
  opts?: {
    fetchImpl?: typeof fetch;
    onProgress?: (p: SynapsePullProgress) => void;
    timeoutMs?: number;
  },
): Promise<SynapsePullResult> {
  const name = model.trim();
  if (!name) return { ok: false, detail: "model name is required" };
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), opts?.timeoutMs ?? 10 * 60_000);
  try {
    const res = await fetchImpl(synapsePullUrl(endpoint.baseUrl), {
      method: "POST",
      headers: {
        ...authHeaders(endpoint.token),
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: name }),
      signal: abort.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let detail = `pull returned ${res.status}`;
      try {
        const j = JSON.parse(text) as { error?: string; message?: string };
        if (typeof j.error === "string") detail = j.error;
        else if (typeof j.message === "string") detail = j.message;
      } catch {
        if (text.trim()) detail = text.trim().slice(0, 200);
      }
      return { ok: false, detail };
    }
    const text = await res.text();
    if (!text.trim()) return { ok: true };
    const lines = text.split(/\r?\n/);
    let sawEvent = false;
    for (const line of lines) {
      const ev = parsePullEvent(line);
      if (!ev) continue;
      sawEvent = true;
      if ("error" in ev) return { ok: false, detail: ev.error };
      if ("done" in ev) return { ok: true };
      opts?.onProgress?.(ev);
    }
    if (!sawEvent) {
      // Non-NDJSON success body (`{status:"success"}` already handled above if it
      // parsed as a done event on the only line). Anything else is still success
      // because the HTTP status was OK.
      return { ok: true };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: (e as Error).message || "pull failed" };
  } finally {
    clearTimeout(timer);
  }
}
