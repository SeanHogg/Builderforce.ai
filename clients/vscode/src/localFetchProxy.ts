import * as vscode from "vscode";
import { describeNetworkError } from "@seanhogg/builderforce-brain-embedded";
import { getLocalModelsConfig } from "./gateway";
import { resolveLocalChatEndpoint } from "./localModels";
import { authorizeLocalEndpoint } from "./localEndpointAuth";

/** The `llm.fetch` request a webview asks the host to perform. */
export interface LocalFetchRequest {
  id?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
}

/**
 * A completion the HOST performs for a webview against a runtime on this machine. See
 * `hostFetch` in webview/src/hostFetch.ts for why it cannot be done in the webview
 * (plain-HTTP localhost is CSP-blocked there, and the runtime would have to allow the
 * `vscode-webview://` origin by CORS besides).
 *
 * One proxy per webview: it tracks that webview's in-flight fetches so `llm.abort` can
 * cancel one it started, and so closing the surface cancels them all.
 */
export class LocalFetchProxy implements vscode.Disposable {
  /** In-flight host-performed fetches, so the webview can cancel one it started. */
  private readonly inFlight = new Map<string, AbortController>();

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly webview: vscode.Webview,
  ) {}

  abort(id: unknown): void {
    if (typeof id === "string") this.inFlight.get(id)?.abort();
  }

  dispose(): void {
    for (const controller of this.inFlight.values()) controller.abort();
    this.inFlight.clear();
  }

  /**
   * Perform one webview-requested fetch against a LOCAL runtime and stream the response
   * back frame by frame.
   *
   * The destination is fenced to the configured on-device endpoints, exactly the
   * "the host, not the caller, names the origin" rule the agent host's egress relay
   * applies: the webview is our own bundle, but a proxy that forwards any URL it is
   * handed is a same-origin request forwarder into the user's machine, and it would
   * outlive whatever we currently believe the webview can be made to send.
   *
   * Bytes are decoded with a STREAMING decoder so a multi-byte character split across
   * two network chunks is not corrupted on its way through postMessage.
   */
  async fetch(msg: LocalFetchRequest): Promise<void> {
    const id = typeof msg.id === "string" ? msg.id : "";
    if (!id) return;
    const url = typeof msg.url === "string" ? msg.url : "";
    const send = (type: string, payload: Record<string, unknown>): void => {
      void this.webview.postMessage({ type, id, ...payload });
    };

    const match = resolveLocalChatEndpoint(getLocalModelsConfig(), url);
    if (!match) {
      send("llm.error", { error: `refused: ${url} is not a configured local model endpoint` });
      return;
    }
    // Resolved here, per request, rather than carried in the panel's init payload: a Kimi
    // token read fifteen minutes ago is no longer valid, and a credential the webview was
    // handed once would be exactly that.
    // A fetch the page performs IS a turn's model call.
    const authorized = await authorizeLocalEndpoint(match.provider, match.endpoint, this.secrets, { interactive: true });
    if (!authorized.ok) {
      send("llm.error", { error: authorized.detail });
      return;
    }
    const endpoint = authorized.endpoint;

    const controller = new AbortController();
    this.inFlight.set(id, controller);
    try {
      // The HOST attaches the credential, and does so LAST so a caller-supplied
      // `authorization` can never override it — the panel composes the request but must
      // neither see this machine's Kimi bearer nor be able to aim one somewhere else.
      // An on-device engine has no token and the header stays absent, exactly as before.
      const { authorization: _drop, Authorization: _dropCased, ...callerHeaders } = msg.headers ?? {};
      const res = await fetch(url, {
        method: msg.method ?? "POST",
        headers: {
          ...callerHeaders,
          ...(endpoint.token ? { authorization: `Bearer ${endpoint.token}` } : {}),
        },
        ...(typeof msg.body === "string" ? { body: msg.body } : {}),
        signal: controller.signal,
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => { headers[key] = value; });
      send("llm.open", { status: res.status, statusText: res.statusText, headers });

      const reader = res.body?.getReader();
      if (!reader) {
        send("llm.end", {});
        return;
      }
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        if (text) send("llm.chunk", { text });
      }
      const tail = decoder.decode();
      if (tail) send("llm.chunk", { text: tail });
      send("llm.end", {});
    } catch (e) {
      send("llm.error", { error: describeNetworkError(e) });
    } finally {
      this.inFlight.delete(id);
    }
  }
}
