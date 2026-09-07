import { apiRequest } from './apiClient';

/**
 * OpenTelemetry collectors this workspace exports agent runs to.
 *
 * Server counterpart: `api/src/presentation/routes/observabilityExportRoutes.ts`.
 * The collector's auth headers are write-only — a read returns `hasHeaders` and
 * never the value, so the panel offers "replace" and "clear" rather than an edit
 * box pre-filled with a credential.
 */

export interface OtelExporter {
  id: string;
  name: string;
  endpoint: string;
  serviceName: string | null;
  /** 0–1. Runs are sampled whole, so a trace is never half-exported. */
  sampleRate: number;
  enabled: boolean;
  hasHeaders: boolean;
  lastExportAt: string | null;
  lastError: string | null;
  /** Failures in a row. Non-zero means spans are being dropped right now. */
  consecutiveFailures: number;
}

export interface OtelExporterInput {
  name: string;
  endpoint: string;
  /** Omit to keep stored headers; `null` clears them. */
  headers?: Record<string, string> | null;
  serviceName?: string | null;
  sampleRate?: number;
  enabled?: boolean;
}

const BASE = '/api/observability/exporters';
const json = (payload: unknown): RequestInit => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

export const observabilityExportApi = {
  list: (): Promise<OtelExporter[]> =>
    apiRequest<{ exporters: OtelExporter[] }>(BASE).then((r) => r.exporters),

  create: (input: OtelExporterInput): Promise<OtelExporter> =>
    apiRequest<{ exporter: OtelExporter }>(BASE, { method: 'POST', ...json(input) }).then((r) => r.exporter),

  update: (id: string, input: Partial<OtelExporterInput>): Promise<OtelExporter> =>
    apiRequest<{ exporter: OtelExporter }>(`${BASE}/${id}`, { method: 'PATCH', ...json(input) }).then((r) => r.exporter),

  remove: (id: string): Promise<{ ok: boolean }> => apiRequest(`${BASE}/${id}`, { method: 'DELETE' }),
};
