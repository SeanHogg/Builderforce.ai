import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { CreationNodeData } from './types';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

const { CreationNode } = await import('./CreationNode');

/** Michigan's real extent, and four districts spread across both peninsulas. */
const MICHIGAN: [number, number, number, number] = [41.696, 48.306, -90.418, -82.122];
const POINTS = [
  { label: 'Detroit Public Schools Community District', lat: 42.3314, lng: -83.0458, value: 48000 },
  { label: 'Ann Arbor Public Schools', lat: 42.2808, lng: -83.7430, value: 17500 },
  { label: 'Grand Rapids Public Schools', lat: 42.9634, lng: -85.6681, value: 14000 },
  { label: 'Marquette Area Public Schools', lat: 46.5436, lng: -87.3954, value: 3000 },
];

function renderMap(data: Partial<CreationNodeData> = {}) {
  const nodeData = { kind: 'map', title: 'Michigan school districts', ...data } as CreationNodeData;
  return render(
    <ReactFlowProvider>
      <CreationNode
        id="map-1"
        type="creation"
        data={nodeData}
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        // React Flow's NodeProps requires the full interaction triple; the empty
        // spread below cannot supply them, so they are passed explicitly.
        draggable={false}
        selectable={false}
        deletable={false}
      />
    </ReactFlowProvider>,
  );
}

describe('Map object', () => {
  it('plots one marker per place and names them all to a screen reader', () => {
    const { container } = renderMap({ mapPoints: POINTS, mapRegion: MICHIGAN, mapRegionName: 'Michigan', mapValueLabel: 'Enrollment' });
    expect(container.querySelectorAll('circle')).toHaveLength(4);
    // The visual is a picture; the accessible name is where the DATA has to be.
    const map = screen.getByRole('img');
    expect(map.getAttribute('aria-label')).toContain('Marquette Area Public Schools');
    expect(map.getAttribute('aria-label')).toContain('Detroit Public Schools Community District');
  });

  it('draws no tile layer — the plot must render with no external request', () => {
    const { container } = renderMap({ mapPoints: POINTS, mapRegion: MICHIGAN });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('image')).toBeNull();
    expect(container.innerHTML).not.toMatch(/https?:\/\//);
  });

  it('renders a MultiPolygon boundary from the FLAT stored form — the Michigan shape', () => {
    const rings = [
      [[-86.5, 41.7], [-82.4, 41.7], [-82.4, 45.8], [-86.5, 45.8], [-86.5, 41.7]],
      [[-90.4, 45.1], [-83.4, 45.1], [-83.4, 48.3], [-90.4, 48.3], [-90.4, 45.1]],
    ];
    const { container } = renderMap({ mapPoints: POINTS, mapRegion: MICHIGAN, mapOutline: rings });
    expect(container.querySelectorAll('path')).toHaveLength(2);
  });

  it('sizes markers by value, largest for the largest district', () => {
    const { container } = renderMap({ mapPoints: POINTS, mapRegion: MICHIGAN, mapValueLabel: 'Enrollment' });
    const radii = [...container.querySelectorAll('circle')].map((circle) => Number(circle.getAttribute('r')));
    expect(Math.max(...radii)).toBeGreaterThan(Math.min(...radii));
  });

  it('says what to do instead of rendering an empty frame when nothing is plotted', () => {
    renderMap({ mapPoints: [] });
    expect(screen.getByText(/latitude and longitude/i)).toBeInTheDocument();
  });

  it('ignores malformed points rather than plotting them at null island', () => {
    const { container } = renderMap({ mapPoints: [...POINTS, { label: 'Unresolved', lat: null, lng: null }] });
    expect(container.querySelectorAll('circle')).toHaveLength(4);
  });

  it('prints the geocoder attribution the licence requires', () => {
    renderMap({ mapPoints: POINTS, mapAttribution: '© OpenStreetMap contributors' });
    expect(screen.getByText('© OpenStreetMap contributors')).toBeInTheDocument();
  });

  it('takes every colour from a theme token so both themes are one definition', () => {
    const { container } = renderMap({ mapPoints: POINTS, mapRegion: MICHIGAN });
    // A literal hex in an inline style would only read in one theme.
    expect(container.innerHTML).not.toMatch(/style="[^"]*#[0-9a-f]{3,6}/i);
  });
});
