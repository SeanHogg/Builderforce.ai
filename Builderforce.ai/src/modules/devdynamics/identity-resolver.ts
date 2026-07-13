// DevDynamics - Identity Reconciliation Service
// Cross-platform contributor identity resolution and management

import type { UnifiedContributor, UnifiedAccount, IdentityLink } from './types';

/**
 * Configuration for identity resolution
 */
export interface IdentityResolutionConfig {
  /** Auto-merge when verified emails match across platforms */
  autoMergeByEmail: boolean;
  /** Consider display name similarity (cosine > threshold) for suggested merges */
  nameSimilarityThreshold: number; // 0..1
  /** Require admin confirmation for merges where emails differ */
  requireAdminConfirmationForDifferentEmails: boolean;
}

const DEFAULT_CONFIG: IdentityResolutionConfig = {
  autoMergeByEmail: true,
  nameSimilarityThreshold: 0.85,
  requireAdminConfirmationForDifferentEmails: true,
};

/**
 * Result of an identity resolution attempt
 */
export interface IdentityResolutionResult {
  /** The resolved contributor profile */
  contributor: UnifiedContributor;
  /** How the resolution was achieved */
  method: 'email_match' | 'manual_link' | 'created';
  /** Whether a merge was performed */
  merged: boolean;
  /** IDs of profiles merged into the primary (if any) */
  mergedProfileIds?: string[];
  /** Any identity links created */
  identityLinkCreated?: IdentityLink;
}

/**
 * Implements DevDynamics FR-1 Cross-Platform Identity Reconciliation.
 *
 * Core algorithm:
 * 1. Look up existing profiles by email across all platforms
 * 2. If email match found → merge into existing profile (auto)
 * 3. If no match → check admin-provided manual links
 * 4. If still no match → create new profile
 */
export class IdentityResolver {
  private config: IdentityResolutionConfig;

  constructor(config?: Partial<IdentityResolutionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Resolve an identity from platform account signals.
   * Called when a new activity event arrives or a new platform account is linked.
   */
  async resolve(
    accounts: UnifiedAccount[],
    repository: {
      findContributorByEmail: (email: string) => Promise<UnifiedContributor | null>;
      findContributorById: (id: string) => Promise<UnifiedContributor | null>;
      findContributorForPlatform: (
        provider: string,
        accountId: string,
      ) => Promise<UnifiedContributor | null>;
      upsertContributor: (data: Partial<UnifiedContributor>) => Promise<UnifiedContributor>;
      createIdentityLink: (link: IdentityLink) => Promise<void>;
      findIdentityLinks: (contributorId: string) => Promise<IdentityLink[]>;
    },
  ): Promise<IdentityResolutionResult> {
    const verifiedAccounts = accounts.filter(a => a.email);
    const primaryEmail = verifiedAccounts[0]?.email;

    // Phase 1: Try email merge
    if (this.config.autoMergeByEmail && primaryEmail) {
      const existingByEmail = await repository.findContributorByEmail(primaryEmail);
      if (existingByEmail) {
        return this.mergeIntoExisting(existingByEmail, accounts, repository, 'email_match');
      }
    }

    // Phase 2: Try platform-specific lookup (username/accountId)
    for (const acct of accounts) {
      const existingByPlatform = await repository.findContributorForPlatform(
        acct.provider,
        acct.providerAccountId,
      );
      if (existingByPlatform) {
        return this.mergeIntoExisting(existingByPlatform, accounts, repository, 'email_match');
      }
    }

    // Phase 3: No match — create new contributor
    const now = new Date();
    const newContributor = await repository.upsertContributor({
      id: crypto.randomUUID(),
      displayName: accounts[0]?.displayName || 'Unknown',
      avatarUrl: accounts[0]?.avatarUrl,
      email: primaryEmail || '',
      emailVerifiedAt: primaryEmail ? now : undefined,
      linkedAccounts: accounts,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    } as Partial<UnifiedContributor>);

    return {
      contributor: newContributor,
      method: 'created',
      merged: false,
    };
  }

  private async mergeIntoExisting(
    existing: UnifiedContributor,
    accounts: UnifiedAccount[],
    repository: {
      upsertContributor: (data: Partial<UnifiedContributor>) => Promise<UnifiedContributor>;
      createIdentityLink: (link: IdentityLink) => Promise<void>;
      findIdentityLinks: (contributorId: string) => Promise<IdentityLink[]>;
    },
    method: 'email_match' | 'manual_link',
  ): Promise<IdentityResolutionResult> {
    const now = new Date();

    // Merge accounts: combine existing + new, deduplicate by provider+accountId
    const existingMap = new Map<string, UnifiedAccount>();
    for (const a of existing.linkedAccounts || []) {
      existingMap.set(`${a.provider}:${a.providerAccountId}`, a);
    }
    for (const a of accounts) {
      const key = `${a.provider}:${a.providerAccountId}`;
      if (!existingMap.has(key)) {
        existingMap.set(key, a);
      }
    }
    const mergedAccounts = Array.from(existingMap.values());

    // Update contributor with merged accounts
    const updated = await repository.upsertContributor({
      id: existing.id,
      displayName: existing.displayName,
      avatarUrl: existing.avatarUrl || accounts[0]?.avatarUrl,
      email: existing.email || accounts[0]?.email,
      linkedAccounts: mergedAccounts,
      updatedAt: now,
      lastSeenAt: now,
    } as Partial<UnifiedContributor>);

    // Create identity links for newly linked accounts
    for (const newAcct of accounts) {
      const existingKey = `${newAcct.provider}:${newAcct.providerAccountId}`;
      const wasAlreadyLinked = existing.linkedAccounts?.some(
        a => a.provider === newAcct.provider && a.providerAccountId === newAcct.providerAccountId,
      );
      if (!wasAlreadyLinked) {
        await repository.createIdentityLink({
          id: crypto.randomUUID(),
          primaryProfileId: existing.id,
          secondaryProfileId: existing.id,
          primaryPlatform: existing.linkedAccounts?.[0]?.provider || newAcct.provider,
          secondaryPlatform: newAcct.provider,
          primaryEmail: existing.email || newAcct.email || '',
          secondaryEmail: newAcct.email || '',
          linkedAt: now,
          linkedBy: method === 'email_match' ? 'system_auto' : 'admin_user',
        } as IdentityLink);
      }
    }

    return {
      contributor: updated,
      method,
      merged: accounts.length > 0,
    };
  }

  /**
   * Manual identity link — FR-1.3 Admin can link two accounts with different emails
   */
  async manualLink(
    primaryProfileId: string,
    secondaryProfileId: string,
    primaryPlatform: string,
    secondaryPlatform: string,
    primaryEmail: string,
    secondaryEmail: string,
    repository: {
      findContributorById: (id: string) => Promise<UnifiedContributor | null>;
      upsertContributor: (data: Partial<UnifiedContributor>) => Promise<UnifiedContributor>;
      createIdentityLink: (link: IdentityLink) => Promise<void>;
    },
  ): Promise<IdentityResolutionResult> {
    const primary = await repository.findContributorById(primaryProfileId);
    const secondary = await repository.findContributorById(secondaryProfileId);

    if (!primary || !secondary) {
      throw new Error(`Contributor not found: ${!primary ? primaryProfileId : secondaryProfileId}`);
    }

    const now = new Date();

    // Merge secondary accounts into primary
    const mergedAccounts = [
      ...(primary.linkedAccounts || []),
      ...(secondary.linkedAccounts || []).filter(
        sa =>
          !(primary.linkedAccounts || []).some(
            pa => pa.provider === sa.provider && pa.providerAccountId === sa.providerAccountId,
          ),
      ),
    ];

    const updated = await repository.upsertContributor({
      id: primary.id,
      displayName: primary.displayName,
      email: primary.email,
      linkedAccounts: mergedAccounts,
      updatedAt: now,
      lastSeenAt: now,
    } as Partial<UnifiedContributor>);

    // Record the manual link
    await repository.createIdentityLink({
      id: crypto.randomUUID(),
      primaryProfileId: primary.id,
      secondaryProfileId: secondary.id,
      primaryPlatform: primaryPlatform as any,
      secondaryPlatform: secondaryPlatform as any,
      primaryEmail,
      secondaryEmail,
      linkedAt: now,
      linkedBy: 'admin_user',
    });

    return {
      contributor: updated,
      method: 'manual_link',
      merged: true,
      mergedProfileIds: [secondary.id],
    };
  }

  /**
   * Find suggested merges based on email or name similarity
   */
  async findSuggestedMerges(
    allContributors: UnifiedContributor[],
  ): Promise<Array<{ primary: UnifiedContributor; secondary: UnifiedContributor; reason: string; confidence: number }>> {
    const suggestions: Array<{ primary: UnifiedContributor; secondary: UnifiedContributor; reason: string; confidence: number }> = [];

    for (let i = 0; i < allContributors.length; i++) {
      for (let j = i + 1; j < allContributors.length; j++) {
        const a = allContributors[i];
        const b = allContributors[j];

        // Check email match
        const aEmails = (a.linkedAccounts || [])
          .map(ac => ac.email)
          .filter(Boolean) as string[];
        const bEmails = (b.linkedAccounts || [])
          .map(ac => ac.email)
          .filter(Boolean) as string[];

        const matchingEmail = aEmails.find(ae => bEmails.includes(ae));
        if (matchingEmail) {
          suggestions.push({
            primary: a,
            secondary: b,
            reason: `Matching email: ${matchingEmail}`,
            confidence: 1.0,
          });
          continue;
        }

        // Name similarity check
        const aName = a.displayName?.toLowerCase() || '';
        const bName = b.displayName?.toLowerCase() || '';
        if (aName && bName) {
          const similarity = this.nameSimilarity(aName, bName);
          if (similarity >= this.config.nameSimilarityThreshold) {
            suggestions.push({
              primary: a,
              secondary: b,
              reason: `Name similarity: ${(similarity * 100).toFixed(0)}%`,
              confidence: similarity,
            });
          }
        }
      }
    }

    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Simple name similarity (bigram Jaccard)
   */
  private nameSimilarity(a: string, b: string): number {
    const bigrams = (s: string): Set<string> => {
      const set = new Set<string>();
      for (let i = 0; i < s.length - 1; i++) {
        set.add(s.slice(i, i + 2));
      }
      return set;
    };

    const aBigrams = bigrams(a);
    const bBigrams = bigrams(b);

    if (aBigrams.size === 0 && bBigrams.size === 0) return 1.0;
    if (aBigrams.size === 0 || bBigrams.size === 0) return 0.0;

    let intersection = 0;
    for (const bg of aBigrams) {
      if (bBigrams.has(bg)) intersection++;
    }
    const union = aBigrams.size + bBigrams.size - intersection;
    return intersection / union;
  }
}

export default IdentityResolver;