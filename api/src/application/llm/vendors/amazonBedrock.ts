/**
 * Amazon Bedrock vendor module — ONE operator-configured AWS credential/region,
 * not a per-tenant multi-account system (same shape as `azureOpenai.ts`'s single
 * operator-configured resource).
 *
 * Bedrock is NOT OpenAI-wire-compatible: it uses the Converse API's own request/
 * response shape (`messages[].content[].text` instead of a plain string, a
 * top-level `system[]` array instead of a `system` role, `inferenceConfig`
 * instead of top-level `temperature`/`max_tokens`) and AWS's own auth scheme
 * (SigV4 request signing, not a Bearer token) — see `awsSigV4.ts`.
 *
 * Same three-value sentinel pattern `cloudflare.ts`/`azureOpenai.ts` use for a
 * vendor needing more than one secret: `apiKeyFrom` composes
 * `<accessKeyId>::<secretAccessKey>::<region>`.
 *
 * Bindings (`wrangler secret put`):
 *   AWS_BEDROCK_ACCESS_KEY_ID
 *   AWS_BEDROCK_SECRET_ACCESS_KEY
 *   AWS_BEDROCK_REGION       — e.g. `us-east-1`.
 * All three must be present for `apiKeyFrom` to return non-null.
 *
 * VERIFICATION NOTE: the SigV4 signing itself is unit-tested against the
 * algorithm AWS documents (see `awsSigV4.test.ts`) and structural properties
 * (determinism, sensitivity to each input) — there is no live AWS credential
 * available in this environment to prove a signed request is ACCEPTED by the
 * real Bedrock endpoint. Treat a first real call as the genuine end-to-end
 * proof, the same way `/api/integrations/:id/test` is for every BYO vendor key.
 */

import { signAwsRequest, canonicalUri } from './awsSigV4';
import { VendorFatalError, VendorRetryableError, type VendorCallParams, type VendorCallResult, type VendorEnv, type VendorModelEntry, type VendorModule } from './types';

const CATALOG: ReadonlyArray<VendorModelEntry> = [
  { id: 'anthropic.claude-3-5-sonnet-20241022-v2:0', label: 'Claude 3.5 Sonnet v2 (Bedrock)', brand: 'Anthropic', tier: 'PREMIUM' },
  { id: 'anthropic.claude-3-5-haiku-20241022-v1:0', label: 'Claude 3.5 Haiku (Bedrock)', brand: 'Anthropic', tier: 'STANDARD' },
  { id: 'meta.llama3-3-70b-instruct-v1:0', label: 'Llama 3.3 70B (Bedrock)', brand: 'Meta', tier: 'STANDARD' },
  { id: 'amazon.titan-text-premier-v1:0', label: 'Titan Text Premier (Bedrock)', brand: 'Amazon', tier: 'STANDARD' },
];
const CATALOG_BY_ID = new Map(CATALOG.map((m) => [m.id, m]));

function splitSentinel(apiKey: string): { accessKeyId: string; secretAccessKey: string; region: string } {
  const parts = apiKey.split('::');
  if (parts.length !== 3 || parts.some((p) => !p)) {
    throw new VendorFatalError('amazon-bedrock', 500, 'malformed amazon-bedrock apiKey sentinel (expected "<accessKeyId>::<secretAccessKey>::<region>")');
  }
  const [accessKeyId, secretAccessKey, region] = parts as [string, string, string];
  return { accessKeyId, secretAccessKey, region };
}

interface ConverseContentBlock { text: string }
interface ConverseMessage { role: 'user' | 'assistant'; content: ConverseContentBlock[] }

/** OpenAI-shaped `messages` → Converse's `{ system, messages }` — Bedrock has
 *  no `system` ROLE; system messages are pulled into their own top-level array. */
function toConverseRequest(params: VendorCallParams): { system?: ConverseContentBlock[]; messages: ConverseMessage[]; inferenceConfig: Record<string, number> } {
  const system: ConverseContentBlock[] = [];
  const messages: ConverseMessage[] = [];
  for (const m of params.messages) {
    const role = String(m.role ?? 'user');
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
    if (role === 'system') { system.push({ text }); continue; }
    messages.push({ role: role === 'assistant' ? 'assistant' : 'user', content: [{ text }] });
  }
  const inferenceConfig: Record<string, number> = {};
  if (params.maxTokens != null) inferenceConfig.maxTokens = params.maxTokens;
  if (params.temperature != null) inferenceConfig.temperature = params.temperature;
  if (params.topP != null) inferenceConfig.topP = params.topP;
  return { ...(system.length ? { system } : {}), messages, inferenceConfig };
}

interface ConverseResponse {
  output?: { message?: { content?: ConverseContentBlock[] } };
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

function fromConverseResponse(raw: ConverseResponse): VendorCallResult {
  const blocks = raw.output?.message?.content ?? [];
  const content = blocks.map((b) => b.text ?? '').join('');
  const usage = raw.usage
    ? {
        prompt_tokens: raw.usage.inputTokens,
        completion_tokens: raw.usage.outputTokens,
        total_tokens: raw.usage.totalTokens,
      }
    : undefined;
  return { raw, content, ...(usage ? { usage } : {}) };
}

export const amazonBedrockModule: VendorModule = {
  id: 'amazon-bedrock',
  catalog: CATALOG,
  tierFor: (modelId) => CATALOG_BY_ID.get(modelId)?.tier ?? 'PREMIUM',
  autoRoute: false,
  apiKeyFrom(env: VendorEnv): string | null {
    const accessKeyId = env.AWS_BEDROCK_ACCESS_KEY_ID ?? null;
    const secretAccessKey = env.AWS_BEDROCK_SECRET_ACCESS_KEY ?? null;
    const region = env.AWS_BEDROCK_REGION ?? null;
    if (!accessKeyId || !secretAccessKey || !region) return null;
    return `${accessKeyId}::${secretAccessKey}::${region}`;
  },
  async call(params: VendorCallParams): Promise<VendorCallResult> {
    const { accessKeyId, secretAccessKey, region } = splitSentinel(params.apiKey);
    const host = `bedrock-runtime.${region}.amazonaws.com`;
    const path = `/model/${params.model}/converse`;
    const body = JSON.stringify(toConverseRequest(params));
    const signed = await signAwsRequest({
      method: 'POST',
      path: canonicalUri(path),
      headers: { host, 'content-type': 'application/json' },
      body,
      region,
      service: 'bedrock',
      accessKeyId,
      secretAccessKey,
    });

    const res = await fetch(`https://${host}${path}`, { method: 'POST', headers: signed.headers, body, signal: params.signal });
    const text = await res.text();
    if (!res.ok) {
      const status = res.status;
      if (status === 429 || status >= 500) {
        throw new VendorRetryableError('amazon-bedrock', params.model, status, text.slice(0, 400));
      }
      throw new VendorFatalError('amazon-bedrock', status, text.slice(0, 400));
    }
    let parsed: ConverseResponse;
    try {
      parsed = JSON.parse(text) as ConverseResponse;
    } catch {
      throw new VendorRetryableError('amazon-bedrock', params.model, 0, 'non-JSON response from Bedrock');
    }
    return fromConverseResponse(parsed);
  },
  // No `callStream` — Converse's streaming counterpart (ConverseStream) emits AWS's
  // own `application/vnd.amazon.eventstream` binary framing, not SSE; adapting that
  // to the OpenAI-SSE shape every stream consumer expects is a separate, larger
  // effort. Streaming dispatch skips this vendor (records `skippedNoStream`),
  // exactly like Cloudflare above.
};
