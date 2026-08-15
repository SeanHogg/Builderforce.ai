import { describe, expect, it, vi, beforeEach } from 'vitest';
import messages from '../i18n/messages/en.json';
import { SEO_INTEGRATIONS } from './content';
import {
  INTEGRATION_CATEGORIES,
  INTEGRATION_SURFACES,
  getIntegrationCatalog,
  leafPageFor,
} from './integrationCatalog';
import { publicApiGet } from './publicApi';

vi.mock('./publicApi', () => ({ publicApiGet: vi.fn() }));

const asMock = () => vi.mocked(publicApiGet);

/**
 * The page renders `t('category.<key>')` for whatever the API sends. A key the catalogs
 * do not carry renders as the raw key or throws, and it did: the API publishes `hiring`
 * (six job-board connectors carry it) and `payout`/`ledger` surfaces, while this reader's
 * union and the message files still held an earlier version. Six connectors sat under a
 * missing heading.
 *
 * `messages.test.ts` holds the five catalogs in step with each other; this holds the
 * VOCABULARY in step with the labels, which is the half neither file was checking.
 */
describe('the reader vocabulary is labelled', () => {
  it('has a category label for every category the API can send', () => {
    for (const category of INTEGRATION_CATEGORIES) {
      expect(messages.integrationsIndex.category, category).toHaveProperty(category);
    }
  });

  it('has a surface label for every surface the API can send', () => {
    for (const surface of INTEGRATION_SURFACES) {
      expect(messages.integrationsIndex.surface, surface).toHaveProperty(surface);
    }
  });
});

describe('leafPageFor', () => {
  it('matches an editorial leaf page by name, not by adapter id', () => {
    // The registry id is the adapter key; the leaf slug is a marketing URL that
    // predates it. Matching on id would have silently unlinked every card.
    const leaf = leafPageFor({
      id: 'github', name: 'GitHub', category: 'devtools', surfaces: ['connector'], direction: 'two-way', capabilities: [],
    });
    expect(leaf?.href).toBe('/integrations/github');
    expect(leaf?.tagline).toBeTruthy();
  });

  it('returns null for a registry entry nobody has written a page for', () => {
    expect(leafPageFor({
      id: 'rally', name: 'Rally', category: 'work', surfaces: ['board'], direction: 'two-way', capabilities: [],
    })).toBeNull();
  });
});

describe('getIntegrationCatalog', () => {
  beforeEach(() => asMock().mockReset());

  it('renders the registry when the API answers', async () => {
    asMock().mockResolvedValue({
      groups: [{ category: 'work', entries: [{ id: 'jira', name: 'Jira', category: 'work', surfaces: ['board'], direction: 'two-way', capabilities: ['webhook'] }] }],
    });
    const groups = await getIntegrationCatalog();
    expect(groups).toHaveLength(1);
    expect(groups[0]?.entries[0]?.name).toBe('Jira');
  });

  it('degrades to the editorial list rather than rendering nothing', async () => {
    // A marketing page that 500s because a catalog endpoint blipped is strictly
    // worse than one showing the curated subset.
    asMock().mockResolvedValue(null);
    const groups = await getIntegrationCatalog();
    expect(groups.flatMap((group) => group.entries)).toHaveLength(SEO_INTEGRATIONS.length);
  });

  it('treats an empty catalog as a failure, not as "we support nothing"', async () => {
    asMock().mockResolvedValue({ groups: [] });
    const groups = await getIntegrationCatalog();
    expect(groups.flatMap((group) => group.entries).length).toBeGreaterThan(0);
  });
});
