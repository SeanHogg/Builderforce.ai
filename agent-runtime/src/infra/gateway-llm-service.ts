/**
 * Gateway-backed LLM service — implements the orchestrator's `ILlmService` port
 * by calling the Builderforce OpenAI-compatible gateway (`/v1/chat/completions`).
 *
 * Builder `llm` nodes (OpenAI / Anthropic / Gemini / … presets) resolve through
 * here, so every model call is metered + routed by the gateway rather than the
 * host holding raw provider keys. The call itself is the runtime's one gateway
 * client ({@link nativeComplete}); this adapter only maps the port's request onto
 * it and turns a failure into the node's `[llm] …` output instead of a throw.
 */

import type { ILlmService, LlmCompletionRequest } from "../builderforce/ports.js";
import { nativeComplete, type LlmMessage } from "../builderforce/model/native-llm.js";
import { logDebug } from "../logger.js";

const GATEWAY_LLM_TIMEOUT_MS = 120_000;

export class GatewayLlmService implements ILlmService {
  constructor(private readonly opts: { baseUrl: string; apiKey: string }) {}

  async complete(req: LlmCompletionRequest): Promise<string> {
    const messages: LlmMessage[] = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    messages.push({ role: "user", content: req.prompt });

    try {
      const result = await nativeComplete(
        this.opts,
        {
          messages,
          ...(req.model ? { model: req.model } : {}),
          ...(req.temperature != null ? { temperature: req.temperature } : {}),
          // The gateway routes/maps the provider id.
          ...(req.provider ? { extra: { provider: req.provider } } : {}),
        },
        AbortSignal.timeout(GATEWAY_LLM_TIMEOUT_MS),
      );
      return result.content;
    } catch (err) {
      logDebug(`[gateway-llm] complete failed: ${String(err)}`);
      return `[llm] request failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
