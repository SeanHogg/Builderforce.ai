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
import { apiRequest } from './apiClient';
import { onTermsGate } from './errors/termsGateEvent';
import { useAuth } from './AuthContext';
import { AUTH_API_URL, checkUnauthorizedAndRedirect, getMe, getMyTenants, type OnboardingProgress } from './auth';
import { creationSessionsApi } from './builderforceApi';

/**
 * Adopt the user's workspace when they have exactly one, so the tenant picker is
 * never shown to somebody with nothing to pick. Both entry points into the
 * "we now have a web token but no tenant token" state need this — the zero-setup
 * landing and the post-terms-bump resume — so it lives here once.
 *
 * Returns true when a workspace was selected. Zero workspaces (server-side
 * provisioning still in flight) or several both fall through to the picker.
 */
async function selectSoleTenant(
  webToken: string,
  selectTenant: (tenant: Awaited<ReturnType<typeof getMyTenants>>[number]) => Promise<void>,
): Promise<boolean> {
  const tenants = await getMyTenants(webToken);
  const sole = tenants.length === 1 ? tenants[0] : undefined;
  if (!sole) return false;
  await selectTenant(sole); // mints the tenant JWT (persisted synchronously)
  return true;
}

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
  selectRole: (accountType: 'standard' | 'freelancer' | 'sales', ageAttested: boolean) => Promise<void>;
  /** Re-fetch terms + role status (e.g. after admin publishes a new version). */
  refresh: () => Promise<void>;
}

export async function fetchTermsStatus(webToken: string): Promise<TermsStatus> {
  return apiRequest<TermsStatus>('/api/auth/legal/terms/status', {
    auth: 'none',
    headers: { Authorization: `Bearer ${webToken}` },
  });
}

export async function acceptActiveTerms(
  webToken: string,
  version: string,
): Promise<void> {
  await apiRequest('/api/auth/legal/terms/accept', {
    method: 'POST',
    auth: 'none',
    headers: { Authorization: `Bearer ${webToken}` },
    body: JSON.stringify({ version }),
  });
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
  // Selecting the brand-new builder's workspace and seeding their first Creation
  // Session. Kept in `loading` so the gate holds the skeleton (never flashes the
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

  // Terms are resolved once, when the web token appears — but the ACTIVE version
  // can move while a session is open, and from that moment the API answers every
  // non-exempt request with 428. Without this the gate kept rendering the chrome
  // it had already decided on, so the user sat behind a wall of failing requests
  // (one toast per background poll) with no way to reach the acceptance screen
  // short of a reload. The transport turns that 428 into TERMS_GATE_EVENT; a
  // re-read flips the phase to 'pending-terms' in place.
  const gateReloading = useRef(false);
  const needsTermsRef = useRef<boolean | null>(null);
  useEffect(() => {
    needsTermsRef.current = needsTerms;
  }, [needsTerms]);

  useEffect(() => onTermsGate(() => {
    // Every in-flight request 428s at once; one re-read settles them all, and
    // once the gate is up there is nothing left to learn.
    if (gateReloading.current || needsTermsRef.current === true) return;
    gateReloading.current = true;
    void load()
      // A transient failure must not wedge the guard shut — the next gated
      // request re-signals, and the gate tries again.
      .catch(() => { /* status re-read failed; the next 428 retries */ })
      .finally(() => { gateReloading.current = false; });
  }), [load]);

  // Zero-setup onboarding, client half. The workspace and its starter project are
  // provisioned SERVER-side now (`ensureStarterWorkspace`, called by every signup
  // door and re-checked on every `GET /api/auth/me`), because doing it here made a
  // brand-new builder's workspace conditional on them staying in the browser long
  // enough for this effect to finish — every drop-off left an account with zero
  // workspaces. What is left here is what only the client can do: pick up that
  // lone workspace so the tenant picker never appears, and seed the first
  // Creation Session that the Dashboard Create tab returns them to.
  // Guardrails:
  //   • builders only — a hired ('freelancer') account has no workspace.
  //   • EXACTLY ONE workspace — a multi-workspace user still gets the picker.
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
        const sole = await selectSoleTenant(webToken, selectTenant);
        if (!sole) return; // zero (server provisioning still in flight) or many → picker
        // A Session, not the Project, is the creator's return point. Best-effort: a
        // temporary API failure must never prevent the user reaching Dashboard,
        // where the prompt can still create a local-first Session. Only seeded when
        // the workspace has none, so a returning user never accumulates duplicates.
        const existing = await creationSessionsApi.list().catch(() => null);
        if (existing && existing.sessions.length === 0) {
          await creationSessionsApi.create({ title: 'My first creation' }).catch(() => {
            console.warn('[onboarding] first Creation Session provisioning failed; Dashboard local-first creation remains available');
          });
        }
      } catch {
        /* fall through to the manual /tenants picker (pending-tenant phase) */
      } finally {
        setProvisioning(false);
      }
    })();
  }, [webToken, tenantToken, needsTerms, needsRole, accountType, provisioning, selectTenant]);

  const selectRole = useCallback(async (accountType: 'standard' | 'freelancer' | 'sales', ageAttested: boolean) => {
    await selectAccountType(accountType, ageAttested);
    // Keep the local copy in lockstep — the auto-provision effect keys off it, and
    // load() won't re-run to refresh it. Without this, a fresh account that just
    // picked Hired would still look 'standard' and wrongly get a workspace.
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
      await selectSoleTenant(webToken, selectTenant).catch(() => false);
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
    // Hold the gate's skeleton while the workspace/project/Session provision, so
    // the tenant picker never flashes for a brand-new builder.
    loading: loading || provisioning,
    terms,
    acceptTerms,
    selectRole,
    refresh: load,
  };
}
