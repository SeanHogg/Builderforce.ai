/**
 * Gateway-backed LLM service — implements the orchestrator's `ILlmService` port
 * by calling the Builderforce OpenAI-compatible gateway (`/v1/chat/completions`).
 *
 * Builder `llm` nodes (OpenAI / Anthropic / Gemini / … presets) resolve through
 * here, so every model call is metered + routed by the gateway rather than the
 * host holding raw provider keys.
 */

import type { ILlmService, LlmCompletionRequest } from "../builderforce/ports.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";
import { logDebug } from "../logger.js";

export class GatewayLlmService implements ILlmService {
  constructor(private readonly opts: { baseUrl: string; apiKey: string }) {}

  async complete(req: LlmCompletionRequest): Promise<string> {
    const url = `${normalizeBaseUrl(this.opts.baseUrl)}/v1/chat/completions`;
    const messages: Array<{ role: string; content: string }> = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    messages.push({ role: "user", content: req.prompt });

    const body: Record<string, unknown> = { messages };
    if (req.model) body.model = req.model;
    if (req.provider) body.provider = req.provider;
    if (req.temperature != null) body.temperature = req.temperature;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return `[llm] gateway error ${res.status}: ${text.slice(0, 300)}`;
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content ?? "";
    } catch (err) {
      logDebug(`[gateway-llm] complete failed: ${String(err)}`);
      return `[llm] request failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
