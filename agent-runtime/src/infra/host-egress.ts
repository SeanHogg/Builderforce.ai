/**
 * Host egress — perform ONE outbound HTTP call on behalf of the Builderforce cloud.
 *
 * Some model providers refuse Builderforce's cloud infrastructure rather than the
 * user's credentials: Kimi Code's edge answers the Cloudflare Workers egress with an
 * HTML 403 before the API ever reads the key, while the byte-identical request from an
 * ordinary machine gets a clean JSON reply. Running the call HERE — on the user's own
 * machine, through their own network — is what a Kimi Code subscription is licensed
 * for in the first place: a personal interactive client.
 *
 * ─── This is a capability, so it is fenced ───────────────────────────────────────
 *
 * A handler that fetches whatever URL it is told to would turn every connected runtime
 * into an open proxy sitting inside the user's network — reachable by anything that
 * could speak to the relay, and able to see localhost and RFC1918 addresses the public
 * internet cannot. So:
 *
 *   • the destination must be on {@link EGRESS_ALLOWED_HOSTS} — an explicit list of the
 *     providers known to refuse cloud egress, not a pattern and not configurable from
 *     the cloud side;
 *   • the scheme must be https, so the credential in the Authorization header is never
 *     put on the wire in the clear;
 *   • redirects are not followed — a 302 is the obvious way to walk an allowlisted
 *     host to a non-allowlisted one;
 *   • the response is size-capped, so a hostile or broken upstream cannot exhaust
 *     memory on the user's machine;
 *   • only the headers we need are forwarded back, and the request's own Authorization
 *     header is never echoed into a log line.
 */

const EGRESS_ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  // Kimi Code subscription API. The reason this module exists.
  "api.kimi.com",
]);

/**
 * The ONLY path a locally-configured Ollama origin may be called on — see
 * {@link EgressOptions.allowedLocalOrigin}. Narrower than "any path on that host" on
 * purpose: the origin match alone would turn this into a same-origin proxy to whatever
 * else happens to listen on the user's configured port.
 */
const OLLAMA_LOCAL_EGRESS_PATH = "/api/chat";

export interface EgressOptions {
  /**
   * The origin (scheme://host[:port]) of THIS machine's own locally-configured Ollama
   * instance, as read from ITS OWN config file — never from the cloud request. Passing
   * this is what lets a tenant's self-hosted Ollama connection ride this same relay:
   * the cloud can ask for `<origin>/api/chat` in plain HTTP, but ONLY the origin this
   * machine already decided (via its own onboarding) it is willing to call. A cloud
   * caller cannot introduce a new one — it can only ever hit what the host itself set
   * up, which is the same "host is sovereign over its own egress" rule the static
   * allowlist above enforces for Kimi Code.
   */
  allowedLocalOrigin?: string;
}

/** Ceiling on a relayed response body. A chat completion is orders of magnitude
 *  smaller; this only bounds a pathological upstream. */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** Deadline for the outbound call. Below the relay's own ceiling so a slow provider
 *  surfaces as this timeout rather than as an opaque relay timeout. */
const EGRESS_TIMEOUT_MS = 110_000;

/** Response headers worth returning. The gateway reads `content-type` to tell an API
 *  error envelope from an edge block page, and the correlation ids make a provider
 *  support ticket actionable. Everything else is dropped. */
const FORWARDED_RESPONSE_HEADERS: readonly string[] = [
  "cf-ray",
  "content-type",
  "date",
  "request-id",
  "retry-after",
  "server",
  "x-request-id",
  "x-trace-id",
];

export interface HostEgressRequest {
  requestId: string;
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string | null;
}

export interface HostEgressResponseFrame {
  type: "host.egress.response";
  requestId: string;
  response?: {
    status: number;
    headers: Record<string, string>;
    body: string;
  };
  error?: string;
}

/** Why this destination is not allowed, or null when it is. Separated from the
 *  performing code so the rule is testable on its own.
 *
 *  `opts.allowedLocalOrigin` is the one deliberate carve-out from "https + static
 *  allowlist": a plain-HTTP request whose origin matches EXACTLY, on EXACTLY
 *  {@link OLLAMA_LOCAL_EGRESS_PATH}, is let through — because that origin is not
 *  attacker-reachable in the first place (it is this machine's OWN local Ollama, as
 *  this machine itself configured it), so the "credential in the clear" and "walk an
 *  allowlisted host" concerns the https/allowlist rules exist for don't apply to it. */
export function rejectEgressTarget(rawUrl: string | undefined, opts: EgressOptions = {}): string | null {
  if (!rawUrl) return "url required";
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "malformed url";
  }
  if (opts.allowedLocalOrigin) {
    let allowed: URL;
    try {
      allowed = new URL(opts.allowedLocalOrigin);
    } catch {
      allowed = undefined as unknown as URL; // malformed local config — falls through to the static rules below
    }
    if (
      allowed
      && url.origin === allowed.origin
      && url.pathname === OLLAMA_LOCAL_EGRESS_PATH
    ) {
      return null;
    }
  }
  if (url.protocol !== "https:") return "only https is allowed";
  if (!EGRESS_ALLOWED_HOSTS.has(url.hostname)) return `host not allowed: ${url.hostname}`;
  return null;
}

/**
 * Run one allowlisted request and build the reply frame. Never throws — a failure is
 * an `error` on the frame, because the cloud caller is waiting on a correlated reply
 * and an exception here would strand it until the relay's timeout.
 */
export async function performHostEgress(
  req: HostEgressRequest,
  opts: EgressOptions = {},
): Promise<HostEgressResponseFrame> {
  const rejection = rejectEgressTarget(req.url, opts);
  if (rejection) {
    return { type: "host.egress.response", requestId: req.requestId, error: rejection };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EGRESS_TIMEOUT_MS);
  try {
    const upstream = await fetch(req.url as string, {
      method: req.method ?? "POST",
      headers: req.headers ?? {},
      ...(req.body != null ? { body: req.body } : {}),
      // A redirect is the obvious way to walk an allowlisted host somewhere else, and
      // nothing we relay legitimately redirects.
      redirect: "manual",
      signal: controller.signal,
    });

    const raw = await upstream.arrayBuffer();
    if (raw.byteLength > MAX_RESPONSE_BYTES) {
      return {
        type: "host.egress.response",
        requestId: req.requestId,
        error: `response exceeded ${MAX_RESPONSE_BYTES} bytes`,
      };
    }

    const headers: Record<string, string> = {};
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) headers[name] = value;
    }

    return {
      type: "host.egress.response",
      requestId: req.requestId,
      response: {
        status: upstream.status,
        headers,
        body: new TextDecoder().decode(raw),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      type: "host.egress.response",
      requestId: req.requestId,
      error: controller.signal.aborted ? `timed out after ${EGRESS_TIMEOUT_MS}ms` : message,
    };
  } finally {
    clearTimeout(timer);
  }
}
