/**
 * The web IDE's model relay for an app's `ai` resources (contract §6): the page gateway asks, this
 * posts the body to the metered gateway through the app's one authenticated transport (the signed-in
 * session rides there, never in a process's environment) and yields the answer as it arrives.
 * Metering is the route's own `logUsage`; nothing is counted here.
 */
import type { AiForwardRequest, HostRelay } from '@seanhogg/builderforce-webcontainers/app';
import { apiRequestStream } from '@/lib/apiClient';

/** The gateway's OpenAI-compatible completions route on the API origin (`createLlmRoutes` is mounted at `/llm`). */
export const CHAT_COMPLETIONS_PATH = '/llm/v1/chat/completions';

/** `app` is the dynamically loaded `@seanhogg/builderforce-webcontainers/app` (the run target already holds it), so this file adds no static import of the runtime. */
export function webHostRelay(app: { connectionSecretsUnfilled: HostRelay['connectionSecrets'] }): HostRelay {
  async function* forwardAi(request: AiForwardRequest): AsyncGenerator<Uint8Array> {
    const response = await apiRequestStream(CHAT_COMPLETIONS_PATH, { method: 'POST', body: request.body as BodyInit, json: true });
    if (!response.ok || !response.body) throw new Error(`The model gateway answered ${response.status}.`);
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }
  return { forwardAi, connectionSecrets: app.connectionSecretsUnfilled };
}
