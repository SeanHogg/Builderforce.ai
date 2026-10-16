/**
 * Which on-device runtimes Rovr looks for, and how a probe of them is read.
 *
 * The registry (`@builderforce/local-inference` `LOCAL_RUNTIMES`) knows Ollama's and
 * FreeToken's default ports. Synapse publishes its port in a discovery file a browser
 * cannot read, but `bfi serve` starts at Ollama's 11434 and stamps `owned_by: 'bfi'` on
 * its catalog rows — so Rovr probes Synapse at 11434 too (or at the address the person
 * set) and lets the registry's `owned_by` rule decide which runtime owns each row.
 *
 * That rule removes a bfi row from Ollama's list, but cannot remove an Ollama row from
 * Synapse's list (Ollama stamps nothing distinctive). {@link resolveLoopbackProbes}
 * finishes the job: a model id listed by BOTH probes of the same address is Ollama's —
 * a bfi row would already have been taken out of Ollama's list — so Synapse keeps only
 * the rows that are genuinely its own, and never claims tool support for an Ollama model.
 */
import {
  HTTP_LOCAL_RUNTIMES,
  normalizeLocalBaseUrl,
  type LocalEndpoints,
  type LocalRuntimeProbe,
} from '@builderforce/local-inference';

/** Where `bfi serve` listens first (Ollama's port; it walks upward when that is taken). */
export const SYNAPSE_DEFAULT_URL = 'http://127.0.0.1:11434';

/** The endpoints to probe: every on-device HTTP runtime's default, Synapse's override.
 *  The browser's built-in model is not among them — it is asked through the page (see
 *  `route.ts`), not probed over HTTP. */
export function loopbackEndpoints(synapseUrl?: string | null): LocalEndpoints {
  const endpoints: Record<string, { baseUrl: string }> = {};
  for (const runtime of HTTP_LOCAL_RUNTIMES) {
    if (!runtime.onDevice) continue;
    if (runtime.defaultBaseUrl) endpoints[runtime.id] = { baseUrl: runtime.defaultBaseUrl };
  }
  endpoints.synapse = { baseUrl: synapseUrl?.trim() || SYNAPSE_DEFAULT_URL };
  return endpoints as LocalEndpoints;
}

/** Drop from Synapse the rows Ollama also lists at the same address (see the header). */
export function resolveLoopbackProbes(probes: readonly LocalRuntimeProbe[]): LocalRuntimeProbe[] {
  const ollama = probes.find((p) => p.provider === 'ollama');
  const synapse = probes.find((p) => p.provider === 'synapse');
  if (!ollama || !synapse) return [...probes];
  if (normalizeLocalBaseUrl(ollama.endpoint.baseUrl) !== normalizeLocalBaseUrl(synapse.endpoint.baseUrl)) return [...probes];
  const ollamaIds = new Set(ollama.models.map((m) => m.model));
  return probes.map((p) => (p === synapse ? { ...p, models: p.models.filter((m) => !ollamaIds.has(m.model)) } : p));
}
