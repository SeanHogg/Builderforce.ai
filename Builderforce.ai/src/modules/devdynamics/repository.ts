// DevDynamics - Repository Implementation
// Minimal in-memory persistence for DevDynamics (Postgres-evolvable)

import type { ActivityEvent, UnifiedContributor, IdentityLink } from './types';

/** Simple in-memory key-value store for example persistence */
const store = {
  contributors: new Map<string, UnifiedContributor>(),
  activities: new Map<string, ActivityEvent>(),
  identityLinks: new Map<string, IdentityLink>(),
};

/**
 * DevDynamicsRepository — FR-2.4 Persistence interface
 * Event raw data must be stored with full provenance before normalization.
 * In production: implement wrapper around PostgreSQL with schema.ts views.
 */
export class DevDynamicsRepository {
  // ---------- Identity resolution ----------
  async findOrCreateContributor(email: string, data: Partial<ActivityEvent['metadata']>): Promise<UnifiedContributor> {
    let existing = Array.from(store.contributors.values()).find(c => c.email === email);
    if (existing) return existing;

    const now = new Date();
    const newContributor: UnifiedContributor = {
      id: crypto.randomUUID(),
      displayName: data.displayName || 'Unknown',
      avatarUrl: data.avatarUrl,
      email,
      emailVerifiedAt: now,
      linkedAccounts: [],
      teamMemberships: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
    store.contributors.set(newContributor.id, newContributor);
    return newContributor;
  }

  async findContributorById(id: string): Promise<UnifiedContributor | null> {
    return store.contributors.get(id) || null;
  }

  async getContributorByEmail(email: string): Promise<UnifiedContributor | null> {
    return Array.from(store.contributors.values()).find(c => c.email === email) || null;
  }

  async findContributorForPlatform(provider: string, accountId: string): Promise<UnifiedContributor | null> {
    return (
      Array.from(store.contributors.values()).find(
        c => c.linkedAccounts?.some(a => a.provider === provider && a.providerAccountId === accountId)
      ) || null
    );
  }

  async upsertContributor(data: Partial<UnifiedContributor>): Promise<UnifiedContributor> {
    if (!data.id) {
      throw new Error('upsertContributor requires an id');
    }
    let contributor = store.contributors.get(data.id);
    const now = new Date();
    if (contributor) {
      Object.assign(contributor, data, { updatedAt: now, lastSeenAt: now });
    } else {
      contributor = { ...(data as UnifiedContributor), id: data.id!, createdAt: now, updatedAt: now, lastSeenAt: now };
      store.contributors.set(data.id, contributor);
    }
    return contributor;
  }

  // PMID-261: events raw stored with provenance
  async ingestActivity(event: ActivityEvent): Promise<void> {
    store.activities.set(event.eventId, event);
  }

  async findActivityByEventId(eventId: string): Promise<ActivityEvent | null> {
    return store.activities.get(eventId) || null;
  }

  async getActivities(
    orgId?: string,
    filters?: { contributorId?: string; provider?: string; eventType?: string; startTime?: string; endTime?: string }
  ): Promise<ActivityEvent[]> {
    let events = Array.from(store.activities.values());
    if (orgId) events = events.filter(e => e.orgId === orgId);
    if (filters?.contributorId) events = events.filter(e => e.contributorId === filters.contributorId);
    if (filters?.provider) events = events.filter(e => e.provider === filters.provider);
    if (filters?.eventType) events = events.filter(e => e.eventType === filters.eventType);
    if (filters?.startTime || filters?.endTime) {
      const start = filters.startTime ? new Date(filters.startTime) : new Date('1970-01-01');
      const end = filters.endTime ? new Date(filters.endTime) : new Date('2100-01-01');
      events = events.filter(e => e.timestamp >= start.toISOString() && e.timestamp <= end.toISOString());
    }
    return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  async findLatestEvents(limit: number = 50): Promise<ActivityEvent[]> {
    const events = await this.getActivities();
    return events.slice(0, limit);
  }

  async getContributorActivity(contributorId: string, since?: string, until?: string): Promise<ActivityEvent[]> {
    return this.getActivities(undefined, { contributorId, startTime: since, endTime: until });
  }

  // Identity links
  async createIdentityLink(link: IdentityLink): Promise<void> {
    store.identityLinks.set(link.id, link);
  }

  async findIdentityLinks(contributorId: string): Promise<IdentityLink[]> {
    return Array.from(store.identityLinks.values()).filter(l => l.primaryProfileId === contributorId || l.secondaryProfileId === contributorId);
  }

  async getAllContributors(limit?: number, offset?: number): Promise<UnifiedContributor[]> {
    const list = Array.from(store.contributors.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = offset ?? 0;
    const end = limit !== undefined ? start + limit : list.length;
    return list.slice(start, end);
  }
}

/** Singleton for convenience (replace with dependency injection in production) */
export const devDynamicsRepository = new DevDynamicsRepository();