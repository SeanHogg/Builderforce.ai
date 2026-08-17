/**
 * Azure OpenAI vendor module — ONE operator-configured Azure resource/deployment,
 * not a per-tenant multi-endpoint system.
 *
 * Azure's Chat Completions API is wire-compatible with OpenAI's (`buildOpenAIChatBody`/
 * `parseOpenAIResponse` apply verbatim) but differs in two ways every other vendor here
 * does not: the endpoint is PER-RESOURCE (`https://<resource>.openai.azure.com/openai/
 * deployments/<deployment>/chat/completions?api-version=<version>`, so it cannot be a
 * static `baseUrl` shared across operators like the OpenAI-compatible factory vendors),
 * and authentication is an `api-key` header, not `Authorization: Bearer`.
 *
 * Same two-value sentinel pattern `cloudflare.ts` uses for its own two-env-var vendor
 * (`<token>::<accountId>`): `apiKeyFrom` composes `<key>::<endpoint>` so the registry's
 * `apiKeyFrom(env): string | null` contract stays a single string, and `call`/`callStream`
 * split it back apart. There is no per-deployment model CATALOG (an operator names their
 * own deployment; it is not a public model id) — the workflow builder pins
 * `direct/azure-openai/default`, and any id routes to the one configured deployment.
 *
 * Bindings (`wrangler secret put`):
 *   AZURE_OPENAI_API_KEY  — the resource's key.
 *   AZURE_OPENAI_ENDPOINT — the FULL chat-completions URL including `?api-version=…`,
 *                           e.g. `https://my-resource.openai.azure.com/openai/deployments/
 *                           gpt-4o/chat/completions?api-version=2024-08-01-preview`.
 * Both must be present for `apiKeyFrom` to return non-null; otherwise the dispatcher
 * skips Azure exactly like any other unbound vendor.
 */

import {
  buildOpenAIChatBody,
  executeChatCompletion,
  executeChatCompletionStream,
  forwardCallOpts,
  VendorFatalError,
  type VendorCallParams,
  type VendorCallResult,
  type VendorEnv,
  type VendorModelEntry,
  type VendorModule,
  type VendorStreamResult,
} from './types';

const CATALOG: ReadonlyArray<VendorModelEntry> = [
  { id: 'default', label: 'Configured deployment (Azure OpenAI)', brand: 'Microsoft', tier: 'PREMIUM' },
];

/** Split the `<key>::<endpoint>` sentinel back apart. The endpoint itself never
 *  contains `::`, so splitting on the FIRST occurrence is exact. */
function splitSentinel(apiKey: string): { key: string; endpoint: string } {
  const i = apiKey.indexOf('::');
  if (i < 0) {
    throw new VendorFatalError('azure-openai', 500, 'malformed azure-openai apiKey sentinel (expected "<key>::<endpoint>")');
  }
  return { key: apiKey.slice(0, i), endpoint: apiKey.slice(i + 2) };
}

export const azureOpenAiModule: VendorModule = {
  id: 'azure-openai',
  catalog: CATALOG,
  tierFor: () => 'PREMIUM',
  autoRoute: false,
  apiKeyFrom(env: VendorEnv): string | null {
    const key = env.AZURE_OPENAI_API_KEY ?? null;
    const endpoint = env.AZURE_OPENAI_ENDPOINT ?? null;
    if (!key || !endpoint) return null;
    return `${key}::${endpoint}`;
  },
  async call(params: VendorCallParams): Promise<VendorCallResult> {
    const { key, endpoint } = splitSentinel(params.apiKey);
    return executeChatCompletion({
      vendorId: 'azure-openai',
      endpoint,
      apiKey: key,
      model: params.model,
      body: buildOpenAIChatBody(params),
      headers: { 'api-key': key },
      ...forwardCallOpts(params),
    });
  },
  async callStream(params: VendorCallParams): Promise<VendorStreamResult> {
    const { key, endpoint } = splitSentinel(params.apiKey);
    return executeChatCompletionStream({
      vendorId: 'azure-openai',
      endpoint,
      apiKey: key,
      model: params.model,
      body: buildOpenAIChatBody(params),
      headers: { 'api-key': key },
      ...forwardCallOpts(params),
    });
  },
};
