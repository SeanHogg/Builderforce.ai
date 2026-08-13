import { describe, expect, it } from 'vitest';
import { analyzeCompetitorGeography, competitorSitesFrom, distanceMiles, normalizeMarketKey } from './competitorGeo';

const TAMPA = { lat: 27.9506, lng: -82.4572 };
const MIAMI = { lat: 25.7617, lng: -80.1918 };

describe('competitorSitesFrom', () => {
  it('reads the shapes a model actually emits', () => {
    const sites = competitorSitesFrom('Acme', [
      { name: 'HQ', city: 'Tampa', region: 'FL', lat: 27.95, lng: -82.45 },
      { city: 'Miami', latitude: '25.76', longitude: '-80.19' },
    ]);
    expect(sites).toHaveLength(2);
    expect(sites[0]).toMatchObject({ competitor: 'Acme', city: 'Tampa', lat: 27.95 });
    expect(sites[1]).toMatchObject({ competitor: 'Acme', lat: 25.76, lng: -80.19 });
  });

  it('drops rows with no usable coordinate rather than plotting them at zero', () => {
    expect(competitorSitesFrom('Acme', [{ city: 'Tampa' }, { lat: 'unknown', lng: null }])).toEqual([]);
  });

  /**
   * 0,0 is Null Island: the coordinate a failed parse produces. Plotting it puts a
   * Florida competitor in the Gulf of Guinea, and — worse — makes every coverage gap
   * in the real market look uncontested because the "nearest competitor" is 5,000
   * miles away rather than absent.
   */
  it('rejects 0,0', () => {
    expect(competitorSitesFrom('Acme', [{ city: 'Nowhere', lat: 0, lng: 0 }])).toEqual([]);
  });

  it('rejects out-of-range coordinates', () => {
    expect(competitorSitesFrom('Acme', [{ lat: 91, lng: 0 }, { lat: 0, lng: 181 }])).toEqual([]);
  });

  it('tolerates a non-array', () => {
    expect(competitorSitesFrom('Acme', undefined)).toEqual([]);
    expect(competitorSitesFrom('Acme', 'Tampa')).toEqual([]);
  });
});

describe('distanceMiles', () => {
  it('measures the Tampa–Miami great circle', () => {
    // ~204 miles. A planar approximation over this span is off by enough to move a
    // metro in or out of a 40-mile coverage radius, which is why it is haversine.
    expect(Math.round(distanceMiles(TAMPA, MIAMI))).toBeGreaterThan(190);
    expect(Math.round(distanceMiles(TAMPA, MIAMI))).toBeLessThan(220);
  });

  it('is zero for a point against itself', () => {
    expect(distanceMiles(TAMPA, TAMPA)).toBeCloseTo(0);
  });
});

describe('normalizeMarketKey', () => {
  it('resolves the phrasings a user actually types', () => {
    expect(normalizeMarketKey('Florida')).toBe('florida');
    expect(normalizeMarketKey('  the Florida market ')).toBe('florida');
    expect(normalizeMarketKey('Florida State')).toBe('florida');
  });
});

describe('analyzeCompetitorGeography', () => {
  const twoTampaRivals = [
    { competitor: 'Acme', city: 'Tampa', ...TAMPA },
    { competitor: 'Globex', city: 'Tampa', lat: 27.99, lng: -82.5 },
  ];

  it('plots every site labelled by its competitor', () => {
    const result = analyzeCompetitorGeography({ sites: twoTampaRivals, allCompetitors: ['Acme', 'Globex'], market: 'Florida' });
    expect(result.points).toHaveLength(2);
    // Labelled by rival, not by site name: on a market map the question is "whose pin".
    expect(result.points.map((point) => point.label).sort()).toEqual(['Acme', 'Globex']);
  });

  it('clusters rivals into the metro they sit in', () => {
    const result = analyzeCompetitorGeography({ sites: twoTampaRivals, allCompetitors: ['Acme', 'Globex'], market: 'Florida' });
    const tampa = result.clusters.find((cluster) => cluster.metro.startsWith('Tampa'));
    expect(tampa).toBeDefined();
    expect(tampa?.siteCount).toBe(2);
    expect(tampa?.competitors).toEqual(['Acme', 'Globex']);
  });

  /** The actual deliverable: where the rivals are NOT. */
  it('reports the uncovered metros, largest first, with the nearest rival named', () => {
    const result = analyzeCompetitorGeography({ sites: twoTampaRivals, allCompetitors: ['Acme', 'Globex'], market: 'Florida' });
    const gapNames = result.gaps.map((gap) => gap.metro);
    expect(gapNames).toContain('Miami–Fort Lauderdale');
    expect(gapNames).toContain('Jacksonville');
    expect(gapNames).not.toContain('Tampa–St. Petersburg');
    // Ordered by population so the biggest opportunity leads.
    expect(gapNames[0]).toBe('Miami–Fort Lauderdale');
    const miami = result.gaps.find((gap) => gap.metro === 'Miami–Fort Lauderdale');
    expect(miami?.nearestCompetitor).toMatch(/Acme|Globex/);
    expect(miami?.nearestMiles).toBeGreaterThan(150);
  });

  it('widens coverage as the radius grows', () => {
    const tight = analyzeCompetitorGeography({ sites: twoTampaRivals, allCompetitors: ['Acme'], market: 'Florida', coverageRadiusMiles: 20 });
    const loose = analyzeCompetitorGeography({ sites: twoTampaRivals, allCompetitors: ['Acme'], market: 'Florida', coverageRadiusMiles: 120 });
    expect(loose.gaps.length).toBeLessThan(tight.gaps.length);
  });

  /**
   * The distinction the tool's instruction turns on: a competitor with no coordinates
   * is UNMAPPED, which is not the same as absent from a region. Reporting it as absent
   * would tell a founder a contested metro is white space.
   */
  it('separates unmapped rivals from mapped ones', () => {
    const result = analyzeCompetitorGeography({
      sites: twoTampaRivals,
      allCompetitors: ['Acme', 'Globex', 'Initech'],
      market: 'Florida',
    });
    expect(result.mappedCompetitors.sort()).toEqual(['Acme', 'Globex']);
    expect(result.unmappedCompetitors).toEqual(['Initech']);
  });

  /**
   * An unknown market must not report "no gaps", which reads as "no opportunity" when
   * it means "no reference geography". It still returns real clustering.
   */
  it('says when the market geography is unknown instead of reporting zero gaps', () => {
    const result = analyzeCompetitorGeography({
      sites: [{ competitor: 'Acme', city: 'Lyon', lat: 45.75, lng: 4.85 }],
      allCompetitors: ['Acme'],
      market: 'Rhône-Alpes',
    });
    expect(result.marketKnown).toBe(false);
    expect(result.gaps).toEqual([]);
    expect(result.region).toBeNull();
    expect(result.clusters).toEqual([{ metro: 'Lyon', siteCount: 1, competitors: ['Acme'] }]);
  });

  it('carries the market bounds so the map frames the real region', () => {
    const result = analyzeCompetitorGeography({ sites: twoTampaRivals, allCompetitors: ['Acme'], market: 'Florida' });
    expect(result.region).toEqual([24.4, 31.1, -87.7, -79.9]);
  });

  it('discards a site whose coordinates are out of range', () => {
    const result = analyzeCompetitorGeography({
      sites: [{ competitor: 'Bad', lat: 999, lng: 0 }],
      allCompetitors: ['Bad'],
      market: 'Florida',
    });
    expect(result.points).toEqual([]);
    expect(result.unmappedCompetitors).toEqual(['Bad']);
  });
});
