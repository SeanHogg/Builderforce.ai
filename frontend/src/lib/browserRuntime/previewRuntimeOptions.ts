/**
 * The Security Shield half of the page runtime's options (make.md › PRD 31 §4 W10) — what
 * `startPreviewRuntime` is told about origins, egress, policies and telemetry, in one place.
 *
 * - Origins (control 1). With `NEXT_PUBLIC_PREVIEW_PER_APP_ORIGINS=true`, every application
 *   runs on its own `https://<key>.preview.builderforce.ai` (`previewOriginTemplate`); the key
 *   is the package's `previewOriginKey(runtime id, application id)`. That needs the wildcard
 *   DNS record and certificate (ROADMAP.md › W10), so until then applications share the relay's
 *   origin under the package's NAMED opt-out, `sharedPreviewOrigin: 'unprotected'` — explicit,
 *   and logged once by the runtime. The API's twin flag is `PREVIEW_PER_APP_ORIGINS`.
 * - Egress (control 6). `previewEgress` is the app's declared external APIs: none yet, because
 *   nothing declares them (ROADMAP.md › W10 gap); the runtime adds its own package CDN.
 *   `workerPolicy` reads the signed policy minted before the app started (`previewWorkerPolicies`).
 * - Telemetry. CSP violations go to the API's `/api/runtime/csp-report`; shield events that
 *   stopped something go to the API through {@link createShieldSink}.
 */
import type { PreviewOriginOption } from '@seanhogg/builderforce-webcontainers';
import { API_ORIGIN, PRODUCTION_API_ORIGIN } from '@/lib/apiOrigin';
import { prepareWorkerPolicy, workerPolicyFor } from './previewWorkerPolicies';
import { createShieldSink } from './shieldSink';

/** Per-application preview origins: on only once their DNS exists. */
export const PER_APP_PREVIEW_ORIGINS = process.env.NEXT_PUBLIC_PREVIEW_PER_APP_ORIGINS === 'true';

/** Each application's own origin, one label under the relay's host; `{key}` is the runtime's `previewOriginKey`. */
export function previewOriginTemplateOf(relayUrl: string): string {
  return `https://{key}.${new URL(relayUrl).host}`;
}

/**
 * Where browsers report CSP violations of preview responses: the API's endpoint, absolute.
 * The API serves `sw.js` only with a report URL it knows, and the runtime drops one that is
 * not https — so a local API (`http://localhost:8787`) reports to production instead.
 */
export function cspReportUrlFor(apiOrigin: string): string {
  return `${apiOrigin.startsWith('https://') ? apiOrigin : PRODUCTION_API_ORIGIN}/api/runtime/csp-report`;
}
export const CSP_REPORT_URL = cspReportUrlFor(API_ORIGIN);

/** A runtime id the package accepts (`[A-Za-z0-9_-]`): the project's id, else the page's workspace. */
export function previewRuntimeIdOf(projectId: string | undefined): string {
  return projectId && /^[A-Za-z0-9_-]{1,64}$/.test(projectId) ? projectId : 'workspace';
}

/** The package's `previewOriginTemplate`, passed in so this module stays free of the runtime's bundle. */
type OriginTemplate = (template: string) => PreviewOriginOption;

/**
 * Mint `applicationId`'s worker egress policy before it starts, on the origin the runtime
 * (booted as `runtimeId`) will open for it — `keyOf` is the package's `previewOriginKey`.
 * Per-application origins only: on the shared origin a policy has no origin to bind to.
 */
export async function prepareApplicationPolicy(
  projectId: string,
  applicationId: string,
  runtimeId: string | null,
  keyOf: (runtimeId: string, applicationId: string) => string,
): Promise<void> {
  if (!PER_APP_PREVIEW_ORIGINS || !runtimeId) return;
  await prepareWorkerPolicy(projectId, applicationId, keyOf(runtimeId, applicationId));
}

/**
 * The shield options for a runtime whose relay is `relayUrl`. `currentProjectId` names the project
 * the page runs now: a workspace event (no application) is filed under it.
 */
export function previewShieldOptions(relayUrl: string, currentProjectId: () => string | null, previewOriginTemplate: OriginTemplate) {
  const origins = PER_APP_PREVIEW_ORIGINS
    ? { previewOrigin: previewOriginTemplate(previewOriginTemplateOf(relayUrl)) }
    : { sharedPreviewOrigin: 'unprotected' as const };
  return {
    ...origins,
    cspReportUrl: CSP_REPORT_URL,
    previewEgress: [] as readonly string[],
    workerPolicy: (applicationId: string) => workerPolicyFor(applicationId),
    security: { sink: createShieldSink({ projectId: currentProjectId }) },
  };
}
