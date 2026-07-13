/**
 * Quality error-source catalog — the SINGLE source of truth for which error /
 * telemetry sources can feed the Quality pillar. Every consumer derives from this
 * list instead of re-declaring its own:
 *   - qualityRoutes (GET /source-catalog, valid `source` on create)
 *   - adapters.ts   (the adapter registry must cover every id here)
 *   - frontend QualitySourcesManager (the picker)
 *
 * Transport tells the UI how data arrives, so it can show the right setup hint:
 *   key     — direct POST of our canonical spec with a per-source ingest key
 *             (the embeddable browser SDK + server/compiled code).
 *   otlp    — an OpenTelemetry exporter points at our OTLP/HTTP endpoint (keyed).
 *   webhook — the provider POSTs its native payload to our webhook URL; an adapter
 *             translates it and an HMAC secret authenticates it.
 */

export type QualitySourceTransport = 'key' | 'otlp' | 'webhook';

export interface QualitySourceMeta {
  /** Stable id — stored on error_sources.source and used to pick the adapter. */
  id: string;
  label: string;
  /** Primary transport surfaced in setup UI (a webhook source may also accept keyed posts). */
  transport: QualitySourceTransport;
  /** True when an inbound provider webhook payload can be HMAC-verified + normalized. */
  supportsWebhook: boolean;
  /** Short setup hint for the picker. */
  hint: string;
}

export const QUALITY_SOURCES: readonly QualitySourceMeta[] = [
  { id: 'native',    label: 'Builderforce SDK',  transport: 'key',     supportsWebhook: false, hint: 'Drop-in browser/Node SDK posting our canonical error format with an ingest key.' },
  { id: 'otlp',      label: 'OpenTelemetry (OTLP)', transport: 'otlp', supportsWebhook: false, hint: 'Point any OTLP/HTTP exporter (logs + error spans) at the ingest endpoint with the key.' },
  { id: 'sentry',    label: 'Sentry',            transport: 'webhook', supportsWebhook: true,  hint: 'Add a Sentry internal-integration / alert webhook pointing at the webhook URL.' },
  { id: 'posthog',   label: 'PostHog',           transport: 'webhook', supportsWebhook: true,  hint: 'Send PostHog $exception events to the webhook URL (HMAC secret optional).' },
  { id: 'logrocket', label: 'LogRocket',         transport: 'webhook', supportsWebhook: true,  hint: 'Configure a LogRocket error webhook pointing at the webhook URL.' },
] as const;

export const QUALITY_SOURCE_IDS: readonly string[] = QUALITY_SOURCES.map((s) => s.id);

export function getQualitySourceMeta(id: string): QualitySourceMeta | undefined {
  return QUALITY_SOURCES.find((s) => s.id === id);
}
