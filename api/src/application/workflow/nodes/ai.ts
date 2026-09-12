/**
 * AI node handlers — `llm`, `analyze-image`, `extract-document-data`,
 * `transcribe-audio`.
 *
 * The three chat-completion kinds run through the gateway: the tenant's
 * BYO-aware proxy when a tenant is in scope, the operator pool otherwise, with
 * spend recorded in the usage ledger. `analyze-image` / `extract-document-data`
 * are one vision turn (`completeVisionPrompt`) that differ only in prompt — Make's
 * document/invoice/receipt "Content Extractor" is this same capability.
 * `transcribe-audio` is a Whisper multipart call — a genuinely different
 * transport, so it does NOT go through `proxy.complete()`.
 */
import { ideProxy, readProxyChoice, type ProxyResult } from '../../llm/LlmProxyService';
import { tenantProxyForPlan, byoAwareModel } from '../../llm/tenantProxy';
import { recordProxyUsage } from '../../llm/usageLedger';
import { assertSafeUrl } from '../../../infrastructure/net/ssrfGuard';
import { fetchPublic } from '../../../infrastructure/net/fetchPublic';
import type { Env } from '../../../env';
import { renderTemplate } from './helpers';
import type { NodeHandlerTable, UsageContext } from './types';

/** The tenant's workflow proxy (BYO-aware) or, without a tenant, the operator pool. */
async function proxyFor(env: Env, usageCtx: UsageContext | undefined) {
  return usageCtx
    ? tenantProxyForPlan(env, usageCtx.tenantId)
    : { proxy: ideProxy(env), byoVendors: new Set<string>(), registeredModels: [] as readonly string[] };
}

/** Record the spend, refuse a failed call, and return the reply text. */
async function settleCompletion(
  env: Env,
  usageCtx: UsageContext | undefined,
  useCase: string,
  result: ProxyResult,
  label: string,
): Promise<string> {
  if (usageCtx) {
    void recordProxyUsage(usageCtx.db, env, { tenantId: usageCtx.tenantId, useCase, result });
  }
  if (!result.response.ok) throw new Error(`${label} call failed (${result.response.status})`);
  return (await readProxyChoice(result)).content;
}

/**
 * One vision-capable turn — an image URL plus a text prompt, on whichever
 * model the tenant's BYO/operator pool routes a vision request to.
 * `poolRouting.ts`'s `hasVision` detection already promotes a vision-capable
 * model whenever it sees this EXACT `{type:'image_url'}` content shape, so no
 * vendor/model pin is needed here.
 */
async function completeVisionPrompt(
  env: Env,
  usageCtx: UsageContext | undefined,
  systemPrompt: string,
  userText: string,
  imageUrl: string,
  useCase: string,
): Promise<string> {
  const messages = [
    ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
    {
      role: 'user' as const,
      content: [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    },
  ];
  const { proxy, byoVendors, registeredModels } = await proxyFor(env, usageCtx);
  const result = await proxy.complete({
    model: byoAwareModel(undefined, byoVendors, registeredModels),
    // The proxy's public `ChatMessage.content` type is `string`; the actual
    // dispatch is content-shape agnostic (`poolRouting.ts` inspects it for
    // `image_url` blocks at runtime), so a vision turn's multipart content is
    // asserted through rather than widening that public type for every caller.
    messages: messages as unknown as Parameters<typeof proxy.complete>[0]['messages'],
  });
  return settleCompletion(env, usageCtx, useCase, result, 'vision');
}

export const AI_NODE_HANDLERS: NodeHandlerTable = {
  llm: async ({ env, node, inputText, usageCtx, outbound }) => {
    if (outbound?.llm) return { output: await outbound.llm(node.config, inputText) };
    const cfg = node.config;
    const system = typeof cfg.system === 'string' ? cfg.system : '';
    const prompt = typeof cfg.prompt === 'string' ? cfg.prompt : '';
    const messages = [
      ...(system ? [{ role: 'system' as const, content: renderTemplate(system, inputText) }] : []),
      { role: 'user' as const, content: renderTemplate(prompt || '{{input}}', inputText) },
    ];
    // The tenant's workflow LLM node → run on their connected BYO account when they
    // have one; the node's configured `cfg.model` is a deliberate choice, so it's
    // honored only when it preempts the BYO seed (nothing connected, or it's on their
    // own account) — otherwise the connected flagship leads.
    const nodeModel = typeof cfg.model === 'string' ? cfg.model : undefined;
    const { proxy, byoVendors, registeredModels } = await proxyFor(env, usageCtx);
    const result = await proxy.complete({
      model: byoAwareModel(nodeModel, byoVendors, registeredModels),
      messages,
      ...(typeof cfg.temperature === 'number' ? { temperature: cfg.temperature } : {}),
    });
    return { output: await settleCompletion(env, usageCtx, 'workflow_llm_node', result, 'llm') };
  },

  'analyze-image': async ({ env, node, inputText, usageCtx, outbound }) => {
    if (outbound?.llm) return { output: await outbound.llm(node.config, inputText) };
    const cfg = node.config;
    const url = renderTemplate(typeof cfg.url === 'string' && cfg.url ? cfg.url : '{{input}}', inputText).trim();
    if (!url) throw new Error('Analyze Image needs an image URL');
    const prompt = typeof cfg.prompt === 'string' && cfg.prompt ? cfg.prompt : 'Describe this image in detail.';
    return { output: await completeVisionPrompt(env, usageCtx, '', prompt, url, 'workflow_analyze_image') };
  },

  'extract-document-data': async ({ env, node, inputText, usageCtx, outbound }) => {
    if (outbound?.llm) return { output: await outbound.llm(node.config, inputText) };
    const cfg = node.config;
    const url = renderTemplate(typeof cfg.url === 'string' && cfg.url ? cfg.url : '{{input}}', inputText).trim();
    if (!url) throw new Error('Extract Document Data needs a document/image URL');
    const fields = typeof cfg.fields === 'string' ? cfg.fields.trim() : '';
    const system = 'You are a document data extraction assistant. Extract exactly the requested fields from the document image. Reply with only a single valid JSON object mapping each requested field to its extracted value (or null if not found) — no markdown, no explanation.';
    const prompt = fields
      ? `Extract these fields: ${fields}`
      : 'Extract every key field visible (e.g. date, total amount, vendor/sender name, line items) as JSON.';
    return { output: await completeVisionPrompt(env, usageCtx, system, prompt, url, 'workflow_extract_document') };
  },

  'transcribe-audio': async ({ env, node, inputText, outbound }) => {
    if (outbound?.transcribeAudio) return { output: await outbound.transcribeAudio(node.config, inputText) };
    // Operator-funded only (no per-tenant BYO path exists for Whisper today, same
    // tradeoff as TAVILY_API_KEY — see `env.ts`'s `OPENAI_API_KEY` doc).
    const cfg = node.config;
    const url = renderTemplate(typeof cfg.url === 'string' && cfg.url ? cfg.url : '{{input}}', inputText).trim();
    if (!url) throw new Error('Transcribe Audio needs an audio file URL');
    const mode = cfg.mode === 'translate' ? 'translate' : 'transcribe';
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Transcribe Audio needs an operator-configured OPENAI_API_KEY');

    const parsed = assertSafeUrl(url, { allowHttp: true });
    const audioRes = await fetchPublic(parsed, { method: 'GET', signal: AbortSignal.timeout(20_000) });
    if (!audioRes.ok) throw new Error(`Could not fetch the audio file (${audioRes.status})`);
    const audioBlob = await audioRes.blob();

    const form = new FormData();
    form.append('file', audioBlob, 'audio');
    form.append('model', 'whisper-1');
    if (mode === 'transcribe' && typeof cfg.language === 'string' && cfg.language) {
      form.append('language', cfg.language);
    }
    const endpoint = mode === 'translate'
      ? 'https://api.openai.com/v1/audio/translations'
      : 'https://api.openai.com/v1/audio/transcriptions';
    const res = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form });
    const body = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
    if (!res.ok) throw new Error(body.error?.message || `Whisper ${mode} failed (${res.status})`);
    return { output: JSON.stringify({ text: body.text ?? '', mode }) };
  },
};
