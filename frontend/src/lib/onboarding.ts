'use client';

/**
 * Single source of truth for the post-login onboarding gate.
 *
 * Order of gates (each one blocks rendering of the chrome until satisfied):
 *   1. Authenticated     — webToken present
 *   2. Terms accepted    — userLegalAcceptances row matches active version
 *   3. Tenant selected   — tenantToken present
 *
 * Email verification is intentionally not yet a gate: the schema has no
 * `users.emailVerifiedAt` column, so there is nothing to check. Logged in
 * the Gap Register so this gate can be added once verification ships.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { AUTH_API_URL, checkUnauthorizedAndRedirect, createTenant, getMe, getMyTenants, type OnboardingProgress } from './auth';
import { createProject, fetchProjects } from './api';

export interface ActiveTermsDoc {
  documentType: 'terms';
  version: string;
  title: string;
  content: string;
  publishedAt: string;
}

export interface TermsStatus {
  requiredVersion: string | null;
  acceptedVersion: string | null;
  needsAcceptance: boolean;
  terms: ActiveTermsDoc;
}

export type OnboardingPhase =
  | 'pre-auth'
  | 'pending-terms'
  | 'pending-role'
  | 'pending-tenant'
  | 'ready';

const ONBOARDING_DISMISSED_KEY = 'bf_onboarding_dismissed';

export interface OnboardingPrompt {
  /** True when the setup wizard should be rendered. */
  show: boolean;
  /** False while the decision is still resolving (callers may hold rendering). */
  checked: boolean;
  /** Persisted step progress from the same `getMe` call — pass it to the stepper
   *  so it resumes where the user left off without a second round-trip. */
  progress: OnboardingProgress | null;
  /** Wizard finished — hide it for this session. */
  complete: () => void;
  /** Wizard dismissed — hide it and remember the dismissal. */
  dismiss: () => void;
}

/**
 * The ONE decision of whether a signed-in user still needs the setup wizard.
 * Both the builder dashboard and the hired (freelancer) dashboard mount the
 * stepper, so the "has it been completed / dismissed / does this role even get
 * onboarding" rules live here rather than being re-implemented per page. Which
 * STEPS the wizard shows is the stepper's own call (account-type track).
 */
export function useOnboardingPrompt(): OnboardingPrompt {
  const { isAuthenticated, webToken, hasTenant, tenant } = useAuth();
  const [show, setShow] = useState(false);
  const [checked, setChecked] = useState(false);
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !webToken || checked) return;

    // Invited members of an existing workspace never see setup — only owners do.
    // (A hired account has no workspace, so this never applies to it.)
    if (hasTenant && tenant?.role && tenant.role !== 'owner') {
      setChecked(true);
      return;
    }

    if (typeof window !== 'undefined' && localStorage.getItem(ONBOARDING_DISMISSED_KEY) === '1') {
      setChecked(true);
      return;
    }

    getMe(webToken)
      .then(({ onboardingCompletedAt, onboardingProgress }) => {
        setProgress(onboardingProgress);
        if (!onboardingCompletedAt) setShow(true);
      })
      .catch(() => { /* a failed check must never block the user */ })
      .finally(() => setChecked(true));
  }, [isAuthenticated, webToken, checked, hasTenant, tenant]);

  const complete = useCallback(() => setShow(false), []);

  const dismiss = useCallback(() => {
    if (typeof window !== 'undefined') localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1');
    setShow(false);
  }, []);

  return { show, checked, progress, complete, dismiss };
}

export interface OnboardingState {
  phase: OnboardingPhase;
  /** True while the gate is still resolving its initial state. */
  loading: boolean;
  /** Active terms document — populated once webToken is present. */
  terms: ActiveTermsDoc | null;
  /** Accept the active terms version. Resolves once the gate advances. */
  acceptTerms: () => Promise<void>;
  /** Make the one-time account-type choice (Build vs Hired). Resolves once the
   *  gate advances past `pending-role`. */
  selectRole: (accountType: 'standard' | 'freelancer') => Promise<void>;
  /** Re-fetch terms + role status (e.g. after admin publishes a new version). */
  refresh: () => Promise<void>;
}

export async function fetchTermsStatus(webToken: string): Promise<TermsStatus> {
  const res = await fetch(`${AUTH_API_URL}/api/auth/legal/terms/status`, {
    headers: { Authorization: `Bearer ${webToken}` },
  });
  checkUnauthorizedAndRedirect(res, true);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Failed to load terms status');
  }
  return (await res.json()) as TermsStatus;
}

export async function acceptActiveTerms(
  webToken: string,
  version: string,
): Promise<void> {
  const res = await fetch(`${AUTH_API_URL}/api/auth/legal/terms/accept`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${webToken}`,
    },
    body: JSON.stringify({ version }),
  });
  checkUnauthorizedAndRedirect(res, true);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Failed to accept terms');
  }
}

/**
 * Drives the post-login gate. Components should not branch on
 * `webToken`/`tenantToken` directly to decide what chrome to render — they
 * should consume `phase` here so all gates evolve together.
 */
export function useOnboardingState(): OnboardingState {
  const { webToken, tenantToken, selectTenant, selectAccountType } = useAuth();

  const [terms, setTerms] = useState<ActiveTermsDoc | null>(null);
  const [needsTerms, setNeedsTerms] = useState<boolean | null>(null);
  const [needsRole, setNeedsRole] = useState<boolean | null>(null);
  const [accountType, setAccountType] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!webToken);
  // Auto-provisioning the zero-setup "Default" workspace + project for a brand-new
  // builder. Kept in `loading` so the gate holds the skeleton (never flashes the
  // tenant picker) while it runs. The ref makes it fire at most once per mount.
  const [provisioning, setProvisioning] = useState(false);
  const provisionAttempted = useRef(false);

  const load = useCallback(async () => {
    if (!webToken) {
      setTerms(null);
      setNeedsTerms(null);
      setNeedsRole(null);
      setAccountType(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Terms + role status resolve together — both gate the chrome.
      const [status, me] = await Promise.all([
        fetchTermsStatus(webToken),
        getMe(webToken),
      ]);
      setTerms(status.terms);
      setNeedsTerms(status.needsAcceptance);
      setNeedsRole(!me.accountTypeSelected);
      // Drives zero-setup provisioning — only a builder ('standard') gets a workspace.
      setAccountType(me.accountType ?? 'standard');
    } finally {
      setLoading(false);
    }
  }, [webToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Zero-setup onboarding: a brand-new builder should land straight in a usable
  // workspace instead of hand-typing a workspace name and a project name. Once
  // terms + role are cleared and no workspace is selected yet, provision a
  // "Default" workspace + "Default" project (both renameable later) and select it.
  // Guardrails:
  //   • builders only — a hired ('freelancer') account has no workspace.
  //   • ZERO existing workspaces only — a returning / multi-workspace user still
  //     flows through the normal picker (auto-selects a lone workspace elsewhere).
  //   • best-effort — any failure falls through to the manual pending-tenant path
  //     (the /tenants picker), so this can never trap a user.
  useEffect(() => {
    if (!webToken || tenantToken) return;
    if (needsTerms !== false || needsRole !== false) return;
    if (accountType !== 'standard') return;
    if (provisioning || provisionAttempted.current) return;
    provisionAttempted.current = true;
    setProvisioning(true);
    void (async () => {
      try {
        const tenants = await getMyTenants(webToken);
        if (tenants.length > 0) return; // existing users keep the normal picker flow
        const tenant = await createTenant(webToken, 'Default');
        await selectTenant(tenant); // mints the tenant JWT (persisted synchronously)
        // Give the new workspace a Default project so the app is immediately usable
        // (createProject also seeds its board + Evermind). Guarded so a returning
        // path that somehow already has projects never gets a duplicate.
        const projects = await fetchProjects().catch(() => []);
        if (projects.length === 0) {
          // Best-effort with a couple of retries: a transient failure here would
          // otherwise strand the fresh workspace with no project. (The dashboard's
          // build prompt can also create one, so this is never a hard dead-end —
          // but we try hard to land the user fully ready.)
          let created = false;
          for (let attempt = 0; attempt < 3 && !created; attempt++) {
            try {
              await createProject({ name: 'Default' });
              created = true;
            } catch {
              if (attempt === 2) {
                // Don't swallow silently — leave a diagnosable signal rather than a mystery empty workspace.
                console.warn('[onboarding] default project provisioning failed after retries');
              }
            }
          }
        }
      } catch {
        /* fall through to the manual /tenants picker (pending-tenant phase) */
      } finally {
        setProvisioning(false);
      }
    })();
  }, [webToken, tenantToken, needsTerms, needsRole, accountType, provisioning, selectTenant]);

  const selectRole = useCallback(async (accountType: 'standard' | 'freelancer') => {
    await selectAccountType(accountType);
    // Keep the local copy in lockstep — the auto-provision effect keys off it, and
    // load() won't re-run to refresh it. Without this, a fresh account that just
    // picked Hired would still look 'standard' and wrongly get a Default workspace.
    setAccountType(accountType);
    setNeedsRole(false);
  }, [selectAccountType]);

  const acceptTerms = useCallback(async () => {
    if (!webToken || !terms) throw new Error('Cannot accept terms before loading');
    await acceptActiveTerms(webToken, terms.version);
    setNeedsTerms(false);
    // After a terms bump, a returning SINGLE-workspace user would otherwise be
    // bounced through the tenant picker: both /my-tenants and /tenant-token are
    // terms-gated, so the callback's auto-select returned null. Now that terms
    // are accepted both are ungated — auto-select the lone workspace so the user
    // lands straight on /dashboard. Guarded: any failure falls through to the
    // normal pending-tenant picker, so this can't regress the multi-workspace
    // or error paths. [1837]
    if (!tenantToken) {
      try {
        const tenants = await getMyTenants(webToken);
        if (tenants.length === 1 && tenants[0]) await selectTenant(tenants[0]);
      } catch {
        /* fall through to the tenant picker (pending-tenant phase) */
      }
    }
  }, [webToken, terms, tenantToken, selectTenant]);

  let phase: OnboardingPhase;
  if (!webToken) {
    phase = 'pre-auth';
  } else if (needsTerms === null || needsTerms === true) {
    phase = 'pending-terms';
  } else if (needsRole === null || needsRole === true) {
    // Role choice comes AFTER terms and BEFORE any workspace/tenant step — it
    // decides whether the user even needs a builder workspace (a freelancer does
    // not). Blocks until an OAuth/magic-link account picks Build vs Hired.
    phase = 'pending-role';
  } else if (!tenantToken) {
    phase = 'pending-tenant';
  } else {
    phase = 'ready';
  }

  return {
    phase,
    // Hold the gate's skeleton while the Default workspace/project provision, so
    // the tenant picker never flashes for a brand-new builder.
    loading: loading || provisioning,
    terms,
    acceptTerms,
    selectRole,
    refresh: load,
  };
}
