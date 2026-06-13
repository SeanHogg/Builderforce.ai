import { describe, it, expect } from 'vitest';
import { marketplaceAgentsSchema } from './structured-data';

describe('marketplaceAgentsSchema [1241]', () => {
  it('emits an ItemList of SoftwareApplications with tags as keywords', () => {
    const schema = marketplaceAgentsSchema([
      { id: 7, name: 'QA Bot', description: 'Runs tests', skills: ['qa', 'playwright'] },
      { id: 'a1', name: 'Doc Writer', skills: [] },
    ]) as { '@graph': Array<Record<string, unknown>> };

    const list = schema['@graph'].find((g) => g['@type'] === 'ItemList') as
      { itemListElement: Array<{ item: Record<string, unknown> }> };
    expect(list.itemListElement).toHaveLength(2);

    const first = list.itemListElement[0]!.item;
    expect(first['@type']).toBe('SoftwareApplication');
    expect(first.name).toBe('QA Bot');
    expect(first.keywords).toBe('qa, playwright'); // tags surfaced for crawlers
    expect(first.description).toBe('Runs tests');

    // Empty skills → no keywords field (don't emit an empty string).
    expect(list.itemListElement[1]!.item.keywords).toBeUndefined();
  });

  it('caps the list at 100 entries', () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ id: i, name: `A${i}` }));
    const schema = marketplaceAgentsSchema(many) as { '@graph': Array<Record<string, unknown>> };
    const list = schema['@graph'].find((g) => g['@type'] === 'ItemList') as { itemListElement: unknown[] };
    expect(list.itemListElement.length).toBe(100);
  });
});
