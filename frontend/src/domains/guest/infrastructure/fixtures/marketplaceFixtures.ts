/**
 * Wire adapters for the MARKETPLACE reads that are about the VIEWER — what the
 * sample workspace has hired and bought.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────
 * The public catalogue. `/api/listings`, `/marketplace/skills`,
 * `/api/workforce/agents`, `/api/jobs` and `/api/marketplace-stats/stats` are
 * anonymous reads that already answer a guest with the REAL storefront, and the
 * transport consults this registry for every token-less GET — including the
 * `auth: 'none'` calls a signed-in visitor makes. A fixture on one of them would
 * replace the live shop window with invented rows for everybody. The registry
 * test asserts none of them is ever covered.
 *
 * What remains are the tenant-scoped lists (`/purchased`, `/mine`,
 * `/acquired`) that 401 for a guest and leave the workforce and seller surfaces
 * empty. They answer with the sample workspace's own state, derived from the
 * same roster the Workforce lens renders.
 */

import type { PublishedAgent } from '@/lib/types';
import type { CreationListing } from '@/lib/creationListings';
import { SAMPLE_MEMBERS } from '../../domain/sampleWorkspace';
import { dayOffsetToIso, exact, type GuestFixture } from '../../domain/guestFixture';

/** When the sample workspace hired its agents — the roster's age, not today. */
const HIRED_DAY_OFFSET = -96;

export const marketplaceFixtures: GuestFixture[] = [
  {
    id: 'marketplace.purchasedAgents',
    match: exact('/api/workforce/agents/purchased'),
    // The agents the sample workspace hired from the marketplace: its AGENT seats,
    // so an assignee picker, the hire page and the workforce roster all offer the
    // same three agents the board assigns tickets to. The human seat is absent —
    // nobody hires the visitor.
    respond: ({ now }): PublishedAgent[] =>
      SAMPLE_MEMBERS.filter((member) => member.kind === 'agent').map((member) => ({
        id: `sample-agent-${member.slug}`,
        project_id: null,
        name: member.name,
        title: member.title,
        bio: `${member.title} on the ${member.name} seat of the sample workspace.`,
        skills: member.skills,
        base_model: 'builderforce-default',
        status: 'active',
        builtin_kind: null,
        hire_count: 1,
        evalScore: null,
        created_at: dayOffsetToIso(now, HIRED_DAY_OFFSET),
        updated_at: dayOffsetToIso(now, -1),
        runtime_support: 'cloud',
        preferred_runtime: 'cloud',
        runtime_surface: 'durable',
        price_cents: 0,
        published: true,
      })),
  },
  {
    id: 'marketplace.creationListings.mine',
    match: exact('/api/creation-listings/mine'),
    // The sample workspace has published nothing — an honest empty shelf, which
    // is what a seller panel should say to somebody who has not sold yet.
    respond: (): { listings: CreationListing[] } => ({ listings: [] }),
  },
  {
    id: 'marketplace.creationListings.acquired',
    match: exact('/api/creation-listings/acquired'),
    respond: (): { acquired: Array<{ listingId: string; slug: string; name: string; kind: string }> } => ({ acquired: [] }),
  },
];

/**
 * The anonymous catalogue reads no fixture may ever cover — exported so the
 * registry test asserts it, rather than a comment hoping it stays true.
 */
export const PUBLIC_MARKETPLACE_READS: readonly string[] = [
  '/api/listings',
  '/marketplace/skills',
  '/api/workforce/agents',
  '/api/jobs',
  '/api/marketplace-stats/stats',
  '/api/knowledge-market/listings',
];
