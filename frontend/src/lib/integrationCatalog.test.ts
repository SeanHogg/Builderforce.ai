import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SEO_INTEGRATIONS } from './content';
import { getIntegrationCatalog, leafPageFor } from './integrationCatalog';
import { publicApiGet } from './publicApi';

vi.mock('./publicApi', () => ({ publicApiGet: vi.fn() }));

const asMock = () => vi.mocked(publicApiGet);

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
