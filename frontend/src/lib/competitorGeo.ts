/**
 * Competitor geography — the analysis behind `canvas_map_competitors`.
 *
 * ── WHAT THIS ANSWERS ────────────────────────────────────────────────────────────
 * "Do a geographical analysis of competitors in the Florida market" is not answered by
 * plotting pins. Pins say where rivals ARE; a founder is buying the answer to where they
 * are NOT, and which of the places they are is worth contesting. So this returns three
 * things from the same pass over the same coordinates:
 *
 *   • `points`   — every competitor site, ready for the EXISTING `map` object. The canvas
 *                  already has a map renderer, a projection, and a region/outline
 *                  vocabulary (`lib/canvasGeo`); a second one for competitors would be
 *                  the duplication the platform rejects, so this produces that shape.
 *   • `clusters` — competitor density by metro. This is the "who is where" table.
 *   • `gaps`     — metros in the target geography with NO competitor site inside the
 *                  coverage radius. This is the actual product of the analysis, and the
 *                  reason the function takes a `market` rather than only a point list.
 *
 * ── WHY THE MARKET GEOGRAPHY IS DATA, NOT A LOOKUP ───────────────────────────────
 * The metro anchors below are the population centres a coverage gap is measured against.
 * They are static because they are geography, not tenant data — Tampa does not move —
 * and because the alternative is a geocoding round trip per metro on every re-analysis,
 * for coordinates that would come back identical. A market the table does not know still
 * works: the analysis falls back to clustering the competitor points themselves and says
 * so, rather than reporting zero gaps, which would read as "no opportunity" when it
 * means "no reference geography".
 */

import type { MapPoint } from './canvasGeo';

export interface CompetitorSite {
  /** The competitor this site belongs to. */
  competitor: string;
  name?: string;
  city?: string;
  region?: string;
  lat: number;
  lng: number;
}

export interface MetroAnchor {
  name: string;
  lat: number;
  lng: number;
  /** Rough population, used only to rank which uncovered metro matters most. */
  population: number;
}

/**
 * Reference metros per market, keyed by a normalized market name.
 *
 * Florida is populated because it is the market the founder scenario names; the shape is
 * per-market on purpose so adding a market is adding data. `population` figures are
 * metro-area orders of magnitude — they rank gaps, they are never reported as facts.
 */
export const MARKET_METROS: Readonly<Record<string, readonly MetroAnchor[]>> = {
  florida: [
    { name: 'Miami–Fort Lauderdale', lat: 25.7617, lng: -80.1918, population: 6_200_000 },
    { name: 'Tampa–St. Petersburg', lat: 27.9506, lng: -82.4572, population: 3_200_000 },
    { name: 'Orlando', lat: 28.5383, lng: -81.3792, population: 2_700_000 },
    { name: 'Jacksonville', lat: 30.3322, lng: -81.6557, population: 1_600_000 },
    { name: 'Sarasota–Bradenton', lat: 27.3364, lng: -82.5307, population: 840_000 },
    { name: 'Cape Coral–Fort Myers', lat: 26.5629, lng: -81.9495, population: 790_000 },
    { name: 'Lakeland', lat: 28.0395, lng: -81.9498, population: 750_000 },
    { name: 'Palm Bay–Melbourne', lat: 28.0345, lng: -80.5887, population: 620_000 },
    { name: 'Pensacola', lat: 30.4213, lng: -87.2169, population: 510_000 },
    { name: 'Port St. Lucie', lat: 27.2730, lng: -80.3582, population: 490_000 },
    { name: 'Tallahassee', lat: 30.4383, lng: -84.2807, population: 390_000 },
    { name: 'Naples', lat: 26.1420, lng: -81.7948, population: 380_000 },
    { name: 'Ocala', lat: 29.1872, lng: -82.1401, population: 380_000 },
    { name: 'Gainesville', lat: 29.6516, lng: -82.3248, population: 340_000 },
  ],
};

/** `[south, north, west, east]`, matching `GeoBounds` and `geo.geocode`'s boundingBox. */
export const MARKET_BOUNDS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  florida: [24.4, 31.1, -87.7, -79.9],
};

export function normalizeMarketKey(market: string): string {
  return market.trim().toLowerCase().replace(/^(the)\s+/, '').replace(/\s+(market|state|region)$/, '').trim();
}

const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle distance in miles. Haversine rather than a planar approximation because
 *  a market can span several degrees of latitude and the error at Florida's extent is
 *  large enough to move a metro in or out of a coverage radius. */
export function distanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface CompetitorCluster {
  metro: string;
  siteCount: number;
  competitors: string[];
}

export interface CoverageGap {
  metro: string;
  population: number;
  nearestCompetitor: string | null;
  nearestMiles: number | null;
}

export interface CompetitorGeoAnalysis {
  points: MapPoint[];
  clusters: CompetitorCluster[];
  gaps: CoverageGap[];
  /** Competitors that contributed at least one usable coordinate. */
  mappedCompetitors: string[];
  /** Competitors present on the board with no usable coordinate, named so the model can
   *  say WHICH rival is missing geography instead of silently plotting fewer pins. */
  unmappedCompetitors: string[];
  /** True when the market had reference metros; false means `gaps` is empty because the
   *  geography is unknown, NOT because there is no opportunity. */
  marketKnown: boolean;
  region: readonly [number, number, number, number] | null;
}

/**
 * Analyse competitor sites against a market.
 *
 * `coverageRadiusMiles` is what "covered" means — a metro with a competitor site inside
 * it. 40 miles is a metro-scale default: close enough that a rival in Tampa is not
 * counted as covering Orlando, wide enough that a suburban office still covers its city.
 */
export function analyzeCompetitorGeography(args: {
  sites: readonly CompetitorSite[];
  allCompetitors: readonly string[];
  market: string;
  coverageRadiusMiles?: number;
}): CompetitorGeoAnalysis {
  const radius = Math.max(1, Math.min(500, args.coverageRadiusMiles ?? 40));
  const marketKey = normalizeMarketKey(args.market);
  const metros = MARKET_METROS[marketKey] ?? [];
  const region = MARKET_BOUNDS[marketKey] ?? null;

  const sites = args.sites.filter((site) => Number.isFinite(site.lat) && Number.isFinite(site.lng)
    && Math.abs(site.lat) <= 90 && Math.abs(site.lng) <= 180);

  const mapped = [...new Set(sites.map((site) => site.competitor))];
  const unmapped = args.allCompetitors.filter((name) => !mapped.includes(name));

  // Each site is labelled with its competitor rather than its own site name: on a map of
  // a market the question is "whose pin is that", and a site name ("Southeast branch")
  // answers a question nobody asked.
  const points: MapPoint[] = sites.slice(0, 500).map((site) => ({
    label: site.competitor,
    lat: site.lat,
    lng: site.lng,
    tone: 'danger',
    detail: [site.name, site.city, site.region].filter(Boolean).join(' · ') || site.competitor,
  }));

  // Cluster by nearest metro when the market is known, and by stated city when it is not
  // — so an unknown market still returns a real "who is where" table.
  const clusterMap = new Map<string, { siteCount: number; competitors: Set<string> }>();
  for (const site of sites) {
    const metro = metros.length
      ? metros.reduce<{ name: string; miles: number } | null>((closest, candidate) => {
        const miles = distanceMiles(site, candidate);
        return !closest || miles < closest.miles ? { name: candidate.name, miles } : closest;
      }, null)
      : null;
    const key = metro && metro.miles <= radius ? metro.name : (site.city?.trim() || metro?.name || site.region?.trim() || site.competitor);
    const entry = clusterMap.get(key) ?? { siteCount: 0, competitors: new Set<string>() };
    entry.siteCount += 1;
    entry.competitors.add(site.competitor);
    clusterMap.set(key, entry);
  }
  const clusters: CompetitorCluster[] = [...clusterMap.entries()]
    .map(([metro, entry]) => ({ metro, siteCount: entry.siteCount, competitors: [...entry.competitors].sort() }))
    .sort((a, b) => b.siteCount - a.siteCount || a.metro.localeCompare(b.metro));

  const gaps: CoverageGap[] = metros
    .map((metro) => {
      const nearest = sites.reduce<{ competitor: string; miles: number } | null>((closest, site) => {
        const miles = distanceMiles(metro, site);
        return !closest || miles < closest.miles ? { competitor: site.competitor, miles } : closest;
      }, null);
      return {
        metro: metro.name,
        population: metro.population,
        nearestCompetitor: nearest?.competitor ?? null,
        nearestMiles: nearest ? Math.round(nearest.miles) : null,
      };
    })
    .filter((gap) => gap.nearestMiles == null || gap.nearestMiles > radius)
    .sort((a, b) => b.population - a.population);

  return { points, clusters, gaps, mappedCompetitors: mapped, unmappedCompetitors: unmapped, marketKnown: metros.length > 0, region };
}

/** Competitor sites read off the `locations` field the spec declares. Tolerant of the
 *  shapes a model actually emits (`latitude`/`longitude`, strings) and silent about rows
 *  it cannot use — the caller reports those through `unmappedCompetitors`. */
export function competitorSitesFrom(competitor: string, locations: unknown): CompetitorSite[] {
  if (!Array.isArray(locations)) return [];
  return locations.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const record = raw as Record<string, unknown>;
    const lat = Number(record.lat ?? record.latitude);
    const lng = Number(record.lng ?? record.lon ?? record.long ?? record.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return [];
    // 0,0 is Null Island — the coordinate a failed parse produces, never a real office.
    if (lat === 0 && lng === 0) return [];
    return [{
      competitor,
      ...(typeof record.name === 'string' ? { name: record.name } : {}),
      ...(typeof record.city === 'string' ? { city: record.city } : {}),
      ...(typeof record.region === 'string' ? { region: record.region } : {}),
      lat,
      lng,
    }];
  });
}
