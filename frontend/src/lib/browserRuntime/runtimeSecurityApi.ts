/**
 * The browser runtime's two calls to the API's Security Shield (make.md › PRD 31 §4 W10):
 * minting an application's signed worker egress policy, and reporting a shield event that
 * stopped something. Both are best-effort plumbing the person never asked for, so neither
 * raises the global error toast: the caller decides what a failure means (here: nothing
 * the person needs to see).
 */
import { apiRequest } from '@/lib/apiClient';
import { TRANSPORT_FAILURE_STATUS } from '@/lib/errors/transportFailure';

/** Failures these calls handle themselves — no toast, no support-ticket prompt. */
const QUIET = [TRANSPORT_FAILURE_STATUS, 400, 403, 404, 409, 413, 422, 429, 500, 502, 503, 504];

/** `POST /api/runtime/worker-policy` → a policy id bound to the application's own preview origin. */
export interface MintedWorkerPolicy {
  policy: string;
  /** ISO-8601; after it the API serves the most restrictive policy for this id. */
  expiresAt: string;
  /** The origin key the server derived: `<originKey>.preview.builderforce.ai`. */
  originKey: string;
}

/** The body `POST /api/security/shield-incidents` takes (api › runtimeShieldRoutes.ts). */
export interface ShieldIncidentReport {
  category: string;
  ruleId: string;
  severity: string;
  reasonCode: string;
  action: string;
  applicationId: string;
  serviceId: string;
  projectId: number;
  evidence: Record<string, string | number | boolean | null>;
  /** ISO-8601. */
  occurredAt: string;
}

export const runtimeSecurityApi = {
  mintWorkerPolicy: (projectId: number, applicationId: string): Promise<MintedWorkerPolicy> =>
    apiRequest<MintedWorkerPolicy>('/api/runtime/worker-policy', {
      method: 'POST',
      body: JSON.stringify({ projectId, applicationId }),
      expectedErrors: QUIET,
    }),

  reportShieldIncident: (report: ShieldIncidentReport): Promise<void> =>
    apiRequest('/api/security/shield-incidents', {
      method: 'POST',
      body: JSON.stringify(report),
      expectedErrors: QUIET,
    }).then(() => undefined),
};
