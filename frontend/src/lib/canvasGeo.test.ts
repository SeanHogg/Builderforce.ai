import { describe, expect, it } from 'vitest';
import {
  detectGeoColumns,
  geoBoundsFor,
  mapObjectFields,
  mapPointsFromRows,
  mercatorY,
  outlinePaths,
  outlineRings,
  projectMap,
  sanitizeGeoBounds,
  sanitizeMapPoints,
} from './canvasGeo';

const MICHIGAN_DISTRICTS = {
  columns: ['District', 'Enrollment', 'Latitude', 'Longitude'],
  rows: [
    { District: 'Detroit Public Schools Community District', Enrollment: 48000, Latitude: 42.3314, Longitude: -83.0458 },
    { District: 'Ann Arbor Public Schools', Enrollment: 17500, Latitude: 42.2808, Longitude: -83.7430 },
    { District: 'Grand Rapids Public Schools', Enrollment: 14000, Latitude: 42.9634, Longitude: -85.6681 },
    { District: 'Marquette Area Public Schools', Enrollment: 3000, Latitude: 46.5436, Longitude: -87.3954 },
  ],
};

describe('detectGeoColumns', () => {
  it('finds coordinate, label and value columns by their conventional names', () => {
    const columns = detectGeoColumns(MICHIGAN_DISTRICTS);
    expect(columns).toEqual({ latitude: 'Latitude', longitude: 'Longitude', label: 'District', value: 'Enrollment' });
  });

  it('matches names that differ only by case and separators', () => {
    const columns = detectGeoColumns({ columns: ['place', 'LAT', 'lng_deg'], rows: [{ place: 'Lansing', LAT: 42.7, lng_deg: -84.5 }] });
    expect(columns.latitude).toBe('LAT');
    expect(columns.longitude).toBe('lng_deg');
    expect(columns.label).toBe('place');
  });

  it('reports no coordinates when the dataset holds only names — the case that must produce an actionable error', () => {
    const columns = detectGeoColumns({ columns: ['District', 'Enrollment'], rows: [{ District: 'Ann Arbor Public Schools', Enrollment: 17500 }] });
    expect(columns.latitude).toBeNull();
    expect(columns.longitude).toBeNull();
  });

  it('honours an explicit value column over the first numeric one', () => {
    expect(detectGeoColumns(MICHIGAN_DISTRICTS, 'Enrollment').value).toBe('Enrollment');
  });
});

describe('mapPointsFromRows', () => {
  it('builds one point per row with its label and value', () => {
    const points = mapPointsFromRows(MICHIGAN_DISTRICTS, detectGeoColumns(MICHIGAN_DISTRICTS));
    expect(points).toHaveLength(4);
    expect(points[0]).toMatchObject({ label: 'Detroit Public Schools Community District', lat: 42.3314, lng: -83.0458, value: 48000 });
  });

  it('DROPS a row whose coordinates did not resolve rather than plotting it at null island', () => {
    const points = mapPointsFromRows({
      columns: ['District', 'Latitude', 'Longitude'],
      rows: [
        { District: 'Resolved', Latitude: 42.3, Longitude: -83 },
        { District: 'Unresolved', Latitude: '', Longitude: '' },
      ],
    }, { latitude: 'Latitude', longitude: 'Longitude', label: 'District', value: null });
    expect(points.map((point) => point.label)).toEqual(['Resolved']);
  });

  it('rejects out-of-range coordinates', () => {
    const points = mapPointsFromRows({
      columns: ['n', 'Latitude', 'Longitude'],
      rows: [{ n: 'bad', Latitude: 120, Longitude: -83 }, { n: 'also bad', Latitude: 42, Longitude: 999 }],
    }, { latitude: 'Latitude', longitude: 'Longitude', label: 'n', value: null });
    expect(points).toEqual([]);
  });

  it('returns nothing when there is no coordinate pair to read', () => {
    expect(mapPointsFromRows(MICHIGAN_DISTRICTS, { latitude: null, longitude: null, label: 'District', value: null })).toEqual([]);
  });
});

describe('sanitizeMapPoints', () => {
  it('accepts lat/lng under any of their spellings, including numeric strings', () => {
    const points = sanitizeMapPoints([
      { label: 'A', lat: 42.3, lng: -83 },
      { name: 'B', latitude: '42.9', longitude: '-85.6', value: '12' },
      { label: 'C', lat: 44, lon: -84, tone: 'danger', detail: 'closing' },
    ]);
    expect(points).toHaveLength(3);
    expect(points[1]).toMatchObject({ label: 'B', lat: 42.9, lng: -85.6, value: 12 });
    expect(points[2]).toMatchObject({ tone: 'danger', detail: 'closing' });
  });

  it('drops malformed entries and unknown tones instead of rendering them', () => {
    const points = sanitizeMapPoints([null, 'nope', { label: 'no coords' }, { label: 'ok', lat: 1, lng: 2, tone: 'chartreuse' }]);
    expect(points).toHaveLength(1);
    expect(points[0]!.tone).toBeUndefined();
  });

  it('is not fooled by a non-array field', () => {
    expect(sanitizeMapPoints({ lat: 1, lng: 2 })).toEqual([]);
  });
});

describe('geoBoundsFor', () => {
  it('fits the points with padding', () => {
    const bounds = geoBoundsFor(sanitizeMapPoints(MICHIGAN_DISTRICTS.rows.map((row) => ({ label: row.District, lat: row.Latitude, lng: row.Longitude }))));
    expect(bounds![0]).toBeLessThan(42.2808);
    expect(bounds![1]).toBeGreaterThan(46.5436);
    expect(bounds![2]).toBeLessThan(-87.3954);
    expect(bounds![3]).toBeGreaterThan(-83.0458);
  });

  it('gives a single point a real extent so the projection cannot divide by zero', () => {
    const bounds = geoBoundsFor([{ label: 'only', lat: 42, lng: -83 }]);
    expect(bounds![1] - bounds![0]).toBeGreaterThan(0);
    expect(bounds![3] - bounds![2]).toBeGreaterThan(0);
  });

  it('prefers an explicit region over the points own extent', () => {
    expect(geoBoundsFor([{ label: 'x', lat: 42, lng: -83 }], [41, 48, -91, -82])).toEqual([41, 48, -91, -82]);
  });

  it('ignores a malformed region and falls back to the points', () => {
    const bounds = geoBoundsFor([{ label: 'x', lat: 42, lng: -83 }], [48, 41, -82, -91]);
    expect(bounds).not.toEqual([48, 41, -82, -91]);
  });

  it('has nothing to fit when there are no points and no region', () => {
    expect(geoBoundsFor([], null)).toBeNull();
  });
});

describe('mercatorY', () => {
  it('is monotonic in latitude', () => {
    expect(mercatorY(46.5)).toBeGreaterThan(mercatorY(42.3));
    expect(mercatorY(0)).toBeCloseTo(0, 10);
  });

  it('clamps the poles instead of returning Infinity', () => {
    expect(Number.isFinite(mercatorY(90))).toBe(true);
    expect(Number.isFinite(mercatorY(-90))).toBe(true);
  });
});

describe('projectMap', () => {
  const points = MICHIGAN_DISTRICTS.rows.map((row) => ({ label: row.District, lat: row.Latitude, lng: row.Longitude, value: row.Enrollment }));

  it('places every point inside the viewBox', () => {
    const projection = projectMap(points, { width: 320, height: 190 })!;
    for (const point of projection.points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(320);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(190);
    }
  });

  it('puts north above south and east right of west', () => {
    const projection = projectMap(points, { width: 320, height: 190 })!;
    const marquette = projection.points.find((point) => point.label.startsWith('Marquette'))!;
    const detroit = projection.points.find((point) => point.label.startsWith('Detroit'))!;
    expect(marquette.y).toBeLessThan(detroit.y);
    expect(marquette.x).toBeLessThan(detroit.x);
  });

  it('scales marker area, not radius, with value', () => {
    const projection = projectMap(points, { width: 320, height: 190 })!;
    const largest = projection.points.find((point) => point.value === 48000)!;
    const smallest = projection.points.find((point) => point.value === 3000)!;
    expect(largest.radius).toBeGreaterThan(smallest.radius);
    // Area-proportional means the radius ratio stays well under the value ratio.
    expect(largest.radius / smallest.radius).toBeLessThan(48000 / 3000);
  });

  it('emits a graticule that spans the plotted extent', () => {
    const projection = projectMap(points, { width: 320, height: 190 })!;
    expect(projection.graticule.verticals.length).toBeGreaterThan(0);
    expect(projection.graticule.horizontals.length).toBeGreaterThan(0);
  });

  it('returns null when there is nothing to project', () => {
    expect(projectMap([], {})).toBeNull();
  });
});

describe('outlineRings', () => {
  const RING = [[-83, 42], [-84, 42], [-84, 43], [-83, 42]];

  it('reads a bare Polygon geometry', () => {
    expect(outlineRings({ type: 'Polygon', coordinates: [RING] })).toEqual([RING]);
  });

  it('reads a MultiPolygon — the shape Michigan actually is', () => {
    expect(outlineRings({ type: 'MultiPolygon', coordinates: [[RING], [RING]] })).toHaveLength(2);
  });

  it('unwraps a Feature and a FeatureCollection', () => {
    expect(outlineRings({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [RING] } })).toEqual([RING]);
    expect(outlineRings({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [RING] } }] })).toEqual([RING]);
  });

  it('passes the already-flattened stored form straight through', () => {
    expect(outlineRings([RING])).toEqual([RING]);
  });

  it('yields nothing for a shape it cannot read', () => {
    expect(outlineRings({ type: 'Point', coordinates: [-83, 42] })).toEqual([]);
    expect(outlineRings(null)).toEqual([]);
    expect(outlineRings('michigan')).toEqual([]);
  });
});

describe('outlinePaths', () => {
  it('reads GeoJSON [lng, lat] order — a swap here lands the outline sideways', () => {
    // A ring spanning much more longitude than latitude must come out WIDER than it is
    // tall; if the pair were read as [lat, lng] it would come out taller than wide.
    const wide = [[-90, 42], [-80, 42], [-80, 43], [-90, 42]];
    const projection = projectMap([{ label: 'a', lat: 42, lng: -90 }, { label: 'b', lat: 43, lng: -80 }], { width: 300, height: 300 })!;
    const [path] = outlinePaths({ type: 'Polygon', coordinates: [wide] }, projection.project);
    const coords = [...path!.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((match) => [Number(match[1]), Number(match[2])] as const);
    const width = Math.max(...coords.map((c) => c[0])) - Math.min(...coords.map((c) => c[0]));
    const height = Math.max(...coords.map((c) => c[1])) - Math.min(...coords.map((c) => c[1]));
    expect(width).toBeGreaterThan(height);
  });

  it('closes each ring', () => {
    const projection = projectMap([{ label: 'a', lat: 42, lng: -83 }], {})!;
    const paths = outlinePaths({ type: 'Polygon', coordinates: [[[-83, 42], [-84, 42], [-84, 43]]] }, projection.project);
    expect(paths[0]!.endsWith(' Z')).toBe(true);
  });

  it('skips a ring that has fewer than two usable positions', () => {
    const projection = projectMap([{ label: 'a', lat: 42, lng: -83 }], {})!;
    expect(outlinePaths({ type: 'Polygon', coordinates: [[[-83, 42]]] }, projection.project)).toEqual([]);
  });
});

describe('sanitizeGeoBounds', () => {
  it('accepts a geocoder boundingBox verbatim', () => {
    expect(sanitizeGeoBounds([41.696, 48.306, -90.418, -82.122])).toEqual([41.696, 48.306, -90.418, -82.122]);
  });

  it('accepts the numeric strings a geocoder actually returns', () => {
    expect(sanitizeGeoBounds(['41.7', '48.3', '-90.4', '-82.1'])).toEqual([41.7, 48.3, -90.4, -82.1]);
  });

  it('rejects an inverted, short, or out-of-range box', () => {
    expect(sanitizeGeoBounds([48, 41, -82, -90])).toBeNull();
    expect(sanitizeGeoBounds([41, 48, -90])).toBeNull();
    expect(sanitizeGeoBounds([41, 200, -90, -82])).toBeNull();
    expect(sanitizeGeoBounds('michigan')).toBeNull();
  });
});

describe('mapObjectFields', () => {
  const POINTS = [{ label: 'Detroit', lat: 42.33, lng: -83.04 }];
  const COLUMNS = { latitude: 'lat', longitude: 'lng', label: 'name', value: 'students' };
  const base = { title: 'Districts', status: '1 plotted', summary: 'Plotted.', points: POINTS, columns: COLUMNS, sourceDatasetId: 'ds-1' };

  it('builds the map object from the points and the detected columns', () => {
    expect(mapObjectFields(base)).toMatchObject({
      title: 'Districts', mapTitle: 'Districts', mapPoints: POINTS,
      mapValueLabel: 'students', sourceDatasetId: 'ds-1',
    });
  });

  it('omits the value label when no numeric column was detected', () => {
    const fields = mapObjectFields({ ...base, columns: { ...COLUMNS, value: null } });
    expect(fields).not.toHaveProperty('mapValueLabel');
  });

  it('FLATTENS a MultiPolygon outline, which is what the patch sanitizer needs', () => {
    // Michigan is a MultiPolygon; stored raw, its positions sit past the sanitizer's
    // four-level depth limit and the outline silently empties. This is the shared step
    // the second call site would otherwise have to remember.
    const outline = { type: 'MultiPolygon', coordinates: [[[[-83, 42], [-84, 42], [-84, 43], [-83, 42]]]] };
    expect(mapObjectFields({ ...base, outline }).mapOutline).toEqual([[[-83, 42], [-84, 42], [-84, 43], [-83, 42]]]);
  });

  it('accepts a geocoder boundingBox as the region and drops a malformed one', () => {
    expect(mapObjectFields({ ...base, region: [41.7, 48.3, -90.4, -82.1] }).mapRegion).toEqual([41.7, 48.3, -90.4, -82.1]);
    expect(mapObjectFields({ ...base, region: [48, 41, -82, -90] })).not.toHaveProperty('mapRegion');
  });

  it('drops blank or non-string region names and attributions rather than storing them', () => {
    expect(mapObjectFields({ ...base, regionName: '   ', attribution: 42 })).not.toHaveProperty('mapRegionName');
    expect(mapObjectFields({ ...base, regionName: '   ', attribution: 42 })).not.toHaveProperty('mapAttribution');
    expect(mapObjectFields({ ...base, regionName: ' Michigan ', attribution: ' © OSM ' })).toMatchObject({
      mapRegionName: 'Michigan', mapAttribution: '© OSM',
    });
  });

  it('carries the caller’s own status and summary, so localized and model-facing copy can differ', () => {
    const fields = mapObjectFields({ ...base, status: 'Auf Karte', summary: 'Zusammenfassung.' });
    expect(fields).toMatchObject({ status: 'Auf Karte', summary: 'Zusammenfassung.' });
  });
});
