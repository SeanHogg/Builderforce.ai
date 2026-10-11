/**
 * @vitest-environment jsdom
 *
 * The marketplace fixtures answer only what is ABOUT the viewer. The public
 * catalogue must never be covered: the transport consults the registry for every
 * token-less GET, so a fixture there would swap the live storefront for invented
 * rows — for guests and for signed-in `auth: 'none'` reads alike.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { resolveGuestRead } from '../../application/guestRead';
import { loadLazyGuestFixtures, resolveGuestFixture } from '../guestFixtureRegistry';
import { PUBLIC_MARKETPLACE_READS } from './marketplaceFixtures';
import { SAMPLE_MEMBERS } from '../../domain/sampleWorkspace';
import type { PublishedAgent } from '@/lib/types';

const read = <T,>(path: string) => resolveGuestRead({ path, method: 'GET', hadToken: false })?.body as T | undefined;

// This module loads on the first guest read, not with the page.
beforeAll(() => loadLazyGuestFixtures());

describe('marketplace fixtures', () => {
  it('never covers a public catalogue read', () => {
    for (const path of PUBLIC_MARKETPLACE_READS) {
      expect(resolveGuestFixture(path), path).toBeNull();
    }
  });

  it("answers the sample workspace's hired agents from its own agent seats", () => {
    const agents = read<PublishedAgent[]>('/api/workforce/agents/purchased')!;
    const seats = SAMPLE_MEMBERS.filter((m) => m.kind === 'agent').map((m) => m.name);
    expect(agents.map((a) => a.name)).toEqual(seats);
  });

  it('answers the seller and buyer shelves with an honest empty list', () => {
    expect(read<{ listings: unknown[] }>('/api/creation-listings/mine')).toEqual({ listings: [] });
    expect(read<{ acquired: unknown[] }>('/api/creation-listings/acquired')).toEqual({ acquired: [] });
  });
});
