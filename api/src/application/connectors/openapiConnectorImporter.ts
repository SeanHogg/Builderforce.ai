/**
 * OpenAPI → connector manifest as a registered IMPORTER — a DRAFT importer: it
 * has a preview and deliberately no commit.
 *
 * The importer gets a connector ~90% of the way; the remaining decisions (which
 * actions matter, whether `mutates` is right for this API) belong to a human,
 * and a silent save would skip that review. So the manifest is returned for the
 * builder to show, and saving it is the normal `POST /api/connectors`.
 *
 * Served at `POST /api/connectors/import/openapi` and
 * `POST /api/import/connector-openapi`, through the one import sequence.
 */
import { TenantRole } from '../../domain/shared/types';
import type { Importer, ImportParse } from '../import/importer';
import { fetchOpenApiSpec, manifestFromOpenApi } from './openapiImport';

export interface OpenApiImportInput {
  key: string;
  specUrl?: string;
  spec?: Record<string, unknown>;
  name?: string;
  icon?: string;
  category?: string;
}

const optionalString = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

export function parseOpenApiImport(body: Record<string, unknown>): ImportParse<OpenApiImportInput> {
  const key = optionalString(body.key);
  if (!key) return { ok: false, error: 'key is required' };
  const spec = body.spec;
  if (spec !== undefined && (typeof spec !== 'object' || spec === null || Array.isArray(spec))) {
    return { ok: false, error: 'spec must be a JSON object' };
  }
  const specUrl = optionalString(body.specUrl);
  if (!spec && !specUrl) return { ok: false, error: 'Provide either specUrl or spec' };
  return {
    ok: true,
    input: {
      key: key.toLowerCase(),
      ...(specUrl ? { specUrl } : {}),
      ...(spec ? { spec: spec as Record<string, unknown> } : {}),
      ...(optionalString(body.name) ? { name: optionalString(body.name) } : {}),
      ...(optionalString(body.icon) ? { icon: optionalString(body.icon) } : {}),
      ...(optionalString(body.category) ? { category: optionalString(body.category) } : {}),
    },
  };
}

/** Manager-gated, like every connector authoring route. */
export const openApiConnectorImporter: Importer<OpenApiImportInput> = {
  kind: 'connector-openapi',
  label: 'Connector from an OpenAPI spec',
  input: 'document',
  minRole: TenantRole.MANAGER,
  parse: parseOpenApiImport,
  async preview(_ctx, input) {
    let spec: unknown = input.spec;
    let fallbackBaseUrl: string | undefined;
    if (!spec && input.specUrl) {
      // Tenant-supplied and fetched SERVER-SIDE, so it goes through the connector
      // runtime's SSRF-guarded fetch — written once, in openapiImport.
      const fetched = await fetchOpenApiSpec(input.specUrl);
      spec = fetched.spec;
      fallbackBaseUrl = fetched.baseUrl;
    }
    const result = manifestFromOpenApi(spec, {
      key: input.key,
      ...(input.name ? { name: input.name } : {}),
      ...(input.icon ? { icon: input.icon } : {}),
      ...(input.category ? { category: input.category } : {}),
      ...(fallbackBaseUrl ? { fallbackBaseUrl } : {}),
    });
    return { status: 'previewed', body: result };
  },
};
