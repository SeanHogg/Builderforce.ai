/**
 * The signed-in person's own account — profile, onboarding, linked sign-in
 * providers — and the workspaces they own.
 *
 * Every call runs WITH a session, so every call goes through `apiRequest` with
 * the person-level (`web`) credential. That is the whole reason this file is
 * separate from `auth/credentials`: these used to be hand-written `fetch`es under
 * the same transport exemption as login, and so they skipped the emulation token,
 * the locale header, the typed 402, the global error report and the 401 redirect
 * that every other request gets.
 *
 * No function takes a token argument any more. The token came from the same
 * stored session `apiRequest` reads, and a second way to pass it is a second
 * place for the two to disagree.
 */

import { apiRequest } from '../apiClient';
import { patchStoredUser } from '../auth';
import type { AuthUser, Tenant } from '../types';
import type { PsychometricProfile } from '../psychometric';

/** Resumable setup-wizard progress, recorded by STEP ID (API migration 0343). */
export interface OnboardingProgress {
  track: 'builder' | 'hired';
  completed: string[];
  activeStep: string | null;
}

export type AccountType = 'standard' | 'freelancer' | 'sales';

/** What the setup gates read off `GET /api/auth/me`. */
export interface MyProfile {
  onboardingCompletedAt: string | null;
  onboardingProgress: OnboardingProgress | null;
  psychometric: PsychometricProfile | null;
  accountType: AccountType;
  accountTypeSelected: boolean;
  availableForHire: boolean;
}

/**
 * What a failed profile read degrades to. `accountTypeSelected: true` so an API
 * failure (or an older API shape) never traps a person behind the role gate.
 */
const PROFILE_FALLBACK: MyProfile = {
  onboardingCompletedAt: null,
  onboardingProgress: null,
  psychometric: null,
  accountType: 'standard',
  accountTypeSelected: true,
  availableForHire: false,
};

type MeUser = Partial<MyProfile> & { displayName?: string | null };

export interface LinkedAccounts {
  accounts: Array<{ provider: string; email: string | null; displayName: string | null }>;
  hasPassword: boolean;
}

const WEB = { auth: 'web' } as const;

export const profileApi = {
  /** The current profile, including onboarding, role-selection, account type and personality. */
  async me(): Promise<MyProfile> {
    try {
      const data = await apiRequest<{ user?: MeUser }>('/api/auth/me', WEB);
      const user = data?.user ?? {};
      return {
        onboardingCompletedAt: user.onboardingCompletedAt ?? null,
        onboardingProgress: user.onboardingProgress ?? null,
        psychometric: user.psychometric ?? null,
        accountType: user.accountType ?? 'standard',
        accountTypeSelected: user.accountTypeSelected ?? true,
        availableForHire: user.availableForHire ?? false,
      };
    } catch {
      // Reported by the transport; the gates keep working on the fallback.
      return PROFILE_FALLBACK;
    }
  },

  /**
   * Opt IN or OUT of being hired talent (independent of account type — a builder keeps
   * the full builder shell). Opting in provisions a for-hire profile stub; opting out
   * unpublishes it. Returns the new availability.
   */
  async setAvailableForHire(available: boolean): Promise<boolean> {
    const data = await apiRequest<{ availableForHire?: boolean }>('/api/freelancers/me/availability', {
      ...WEB, method: 'POST', body: JSON.stringify({ available }),
    });
    return data?.availableForHire ?? available;
  },

  /**
   * Make the one-time account-type choice (Build vs Hired) for an OAuth/magic-link
   * account that never picked on the /register form. Returns the updated user.
   */
  async selectAccountType(accountType: AccountType, ageAttested: boolean): Promise<AuthUser> {
    const data = await apiRequest<{ user: AuthUser }>('/api/auth/me/account-type', {
      ...WEB, method: 'POST', body: JSON.stringify({ accountType, ageAttested }),
    });
    return data.user;
  },

  /**
   * Update the signed-in user's display name. The stored user is patched in place
   * so the top bar and the footer roster show the new name without a reload.
   */
  async updateDisplayName(displayName: string): Promise<string | null> {
    const data = await apiRequest<{ user?: { displayName?: string | null } }>('/api/auth/me', {
      ...WEB, method: 'PATCH', body: JSON.stringify({ displayName }),
    });
    const next = data?.user?.displayName ?? null;
    patchStoredUser({ name: next ?? undefined });
    return next;
  },

  /** Update the person's OWN personality. Pass null to clear it. Not Pro-gated. */
  async updatePersonality(psychometric: PsychometricProfile | null): Promise<PsychometricProfile | null> {
    const data = await apiRequest<{ user?: { psychometric?: PsychometricProfile | null } }>('/api/auth/me', {
      ...WEB, method: 'PATCH', body: JSON.stringify({ psychometric }),
    });
    return data?.user?.psychometric ?? null;
  },

  /** Mark onboarding as complete and optionally store user intent. */
  async completeOnboarding(intent?: string[]): Promise<void> {
    await apiRequest('/api/auth/me/onboarding/complete', {
      ...WEB, method: 'POST', body: JSON.stringify({ intent }), raw: true,
    });
  },

  /**
   * Persist which setup-wizard steps are done, so closing the wizard mid-way
   * resumes where the user left off. Best-effort: a failed write only costs the
   * resume position, never the flow.
   */
  async saveOnboardingProgress(progress: OnboardingProgress): Promise<void> {
    await apiRequest('/api/auth/me/onboarding/progress', {
      ...WEB, method: 'PUT', body: JSON.stringify(progress), raw: true,
    }).catch(() => { /* resume position is best-effort */ });
  },

  /** OAuth providers linked to the current account. */
  async linkedAccounts(): Promise<LinkedAccounts> {
    return apiRequest<LinkedAccounts>('/api/auth/linked-accounts', WEB);
  },

  /** Unlink an OAuth provider from the current account. */
  async unlinkProvider(provider: string): Promise<void> {
    await apiRequest(`/api/auth/unlink/${encodeURIComponent(provider)}`, { ...WEB, method: 'DELETE', raw: true });
  },

  /** Add a password to an OAuth-only account. */
  async addPassword(password: string): Promise<void> {
    await apiRequest('/api/auth/add-password', {
      ...WEB, method: 'POST', body: JSON.stringify({ password }), raw: true,
    });
  },
};

type TenantRow = { id: number; name: string; slug?: string };

export const workspacesApi = {
  /** Create a new workspace. The caller becomes its owner. */
  async create(name: string): Promise<Tenant> {
    const data = await apiRequest<TenantRow>('/api/tenants/create', {
      ...WEB, method: 'POST', body: JSON.stringify({ name: name.trim() }),
    });
    return { id: String(data.id), name: data.name, slug: data.slug, role: 'owner' };
  },

  /** Rename a workspace. The caller must be its owner or a manager. */
  async rename(tenantId: string, name: string): Promise<Tenant> {
    const data = await apiRequest<TenantRow>(`/api/tenants/${encodeURIComponent(tenantId)}/name`, {
      ...WEB, method: 'PATCH', body: JSON.stringify({ name: name.trim() }),
    });
    return { id: String(data.id), name: data.name, slug: data.slug };
  },
};
