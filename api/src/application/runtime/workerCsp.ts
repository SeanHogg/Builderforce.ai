/**
 * What the API adds to the in-browser preview origins' Content-Security-Policies
 * (make.md §4 W10, controls 1 and 6): where they report, and where the runtime's files live.
 *
 * Every CSP string itself — the process Worker, `sw.js`, `relay.html` and document policies,
 * `DEFAULT_CONNECT_SOURCES`, `PREVIEW_DEFAULT_EGRESS`, `PREVIEW_WORKER_SCRIPTS` — has ONE owner:
 * `@seanhogg/builderforce-webcontainers/preview-headers`. The headers that carry them, under
 * the API's profile, are {@link ./previewOriginHeaders}.
 */
import type { PreviewCspReporting } from '@seanhogg/builderforce-webcontainers/preview-headers';
import { DEFAULT_INTERNAL_API_BASE_URL } from './sandbox/egressAllowlist';

/** The preview origin's script directory (the service worker's scope). */
export const PREVIEW_SCRIPT_PREFIX = '/__bfwc/';

/** Where browsers send CSP violation reports. On the API host: reports are telemetry only. */
export const CSP_REPORT_PATH = '/api/runtime/csp-report';
export const CSP_REPORT_URL = `${DEFAULT_INTERNAL_API_BASE_URL}${CSP_REPORT_PATH}`;

/** The `report-to` group name every reporting policy names. */
export const CSP_REPORT_GROUP = 'bfwc-csp';

/** The API's CSP reporting: {@link CSP_REPORT_GROUP}, declared by a `Reporting-Endpoints` value naming {@link CSP_REPORT_URL}. */
export const PREVIEW_CSP_REPORTING: Readonly<PreviewCspReporting> = Object.freeze({
  group: CSP_REPORT_GROUP,
  endpoints: `${CSP_REPORT_GROUP}="${CSP_REPORT_URL}"`,
});
