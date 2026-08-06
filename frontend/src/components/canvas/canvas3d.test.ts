import { describe, expect, it } from 'vitest';
import {
  CANVAS_3D_LAYER_GAP,
  CANVAS_3D_MAX_PITCH,
  CANVAS_3D_MAX_ZOOM,
  CANVAS_3D_MIN_ZOOM,
  canvas3dLinkTransform,
  canvas3dOrbitAfterDrag,
  canvas3dOrbitAfterZoom,
  canvas3dScene,
  canvas3dStageTransform,
  canvas3dZoomFactorFromWheel,
  wrapDegrees,
  type Canvas3DNode,
} from './canvas3d';
import { graphLayerRanks } from './canvasGraph';

const node = (id: string, x: number, y: number, width = 200, height = 100): Canvas3DNode & { group: string } => ({
  id,
  position: { x, y },
  style: { width, height },
  group: id.startsWith('d') ? 'Data' : 'Build',
});

const describe3D = (candidate: Canvas3DNode & { group: string }) => ({ label: candidate.id, group: candidate.group });

describe('canvas3dScene', () => {
  it('stacks connected objects by dependency depth and centres the stack', () => {
    const nodes = [node('a', 0, 0), node('b', 400, 0), node('c', 800, 0)];
    const scene = canvas3dScene({
      nodes,
      edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }],
      describe: describe3D,
    });

    const byId = Object.fromEntries(scene.cards.map((card) => [card.id, card]));
    expect([byId.a!.layer, byId.b!.layer, byId.c!.layer]).toEqual([0, 1, 2]);
    expect(byId.a!.z).toBe(-CANVAS_3D_LAYER_GAP);
    expect(byId.b!.z).toBe(0);
    expect(byId.c!.z).toBe(CANVAS_3D_LAYER_GAP);
    expect(scene.layers.map((layer) => layer.count)).toEqual([1, 1, 1]);
  });

  it('keeps every object on one plane when nothing is connected', () => {
    const scene = canvas3dScene({ nodes: [node('a', 0, 0), node('b', 300, 200)], edges: [], describe: describe3D });

    expect(scene.layers).toHaveLength(1);
    expect(new Set(scene.cards.map((card) => card.z))).toEqual(new Set([0]));
    // Board coordinates are preserved relative to one another, only re-centred.
    expect(scene.cards[1]!.x - scene.cards[0]!.x).toBe(300);
    expect(scene.cards[1]!.y - scene.cards[0]!.y).toBe(200);
  });

  it('stacks by object group when asked, ignoring the connections', () => {
    const scene = canvas3dScene({
      nodes: [node('a', 0, 0), node('d1', 300, 0), node('b', 600, 0)],
      edges: [{ source: 'a', target: 'b' }],
      describe: describe3D,
      depthMode: 'group',
    });

    // Groups are ordered deterministically: Build before Data.
    expect(scene.layers.map((layer) => layer.label)).toEqual(['Build', 'Data']);
    expect(scene.cards.filter((card) => card.group === 'Build').map((card) => card.layer)).toEqual([0, 0]);
    expect(scene.cards.find((card) => card.id === 'd1')!.layer).toBe(1);
  });

  it('drops connections to objects that are not in the scene', () => {
    const scene = canvas3dScene({
      nodes: [node('a', 0, 0), node('b', 400, 0)],
      edges: [{ source: 'a', target: 'b' }, { source: 'a', target: 'hidden' }, { source: 'a', target: 'a' }],
      describe: describe3D,
    });

    expect(scene.links).toHaveLength(1);
    expect(scene.links[0]).toMatchObject({ source: 'a', target: 'b', spansLayers: true });
  });

  it('returns an empty scene rather than NaN geometry for an empty canvas', () => {
    const scene = canvas3dScene({ nodes: [], edges: [], describe: describe3D });
    expect(scene).toMatchObject({ cards: [], links: [], layers: [], plane: { width: 0, height: 0 } });
  });
});

describe('graphLayerRanks', () => {
  it('gives every node in a cycle its own layer instead of piling them at zero', () => {
    const { ranks, connected } = graphLayerRanks(
      [{ id: 'a' }, { id: 'b' }],
      [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }],
    );

    expect(connected).toBe(true);
    expect(new Set(ranks.values()).size).toBe(2);
  });
});

describe('canvas3dLinkTransform', () => {
  it('measures the true 3D distance between two cards', () => {
    const { length } = canvas3dLinkTransform({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 12 });
    expect(length).toBe(13);
  });

  it('rotates a bar along +X onto a purely horizontal connection', () => {
    const { transform } = canvas3dLinkTransform({ x: 10, y: 20, z: 0 }, { x: 110, y: 20, z: 0 });
    expect(transform).toBe('translate3d(10px, 20px, 0px) rotateZ(0deg) rotateY(0deg)');
  });

  it('tilts a connection that runs straight toward the viewer', () => {
    // +Z is toward the viewer, and CSS rotateY maps +X to (cos, 0, -sin), so a
    // link that only gains depth must be a -90 degree Y rotation.
    const { transform } = canvas3dLinkTransform({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 100 });
    expect(transform).toContain('rotateY(-90deg)');
  });

  it('collapses to a translation when both ends coincide', () => {
    expect(canvas3dLinkTransform({ x: 5, y: 5, z: 5 }, { x: 5, y: 5, z: 5 })).toEqual({
      transform: 'translate3d(5px, 5px, 5px)',
      length: 0,
    });
  });
});

describe('orbit', () => {
  const orbit = { yaw: 0, pitch: 0, zoom: 1 };

  it('turns with a horizontal drag and raises the camera with an upward drag', () => {
    expect(canvas3dOrbitAfterDrag(orbit, 100, 0).yaw).toBeGreaterThan(0);
    expect(canvas3dOrbitAfterDrag(orbit, 0, -100).pitch).toBeGreaterThan(0);
  });

  it('clamps pitch instead of flipping the scene over the pole', () => {
    expect(canvas3dOrbitAfterDrag(orbit, 0, -10_000).pitch).toBe(CANVAS_3D_MAX_PITCH);
    expect(canvas3dOrbitAfterDrag(orbit, 0, 10_000).pitch).toBe(-CANVAS_3D_MAX_PITCH);
  });

  it('wraps yaw so a few spins do not report 720 degrees', () => {
    expect(canvas3dOrbitAfterDrag({ ...orbit, yaw: 179 }, 100, 0).yaw).toBeLessThan(0);
    expect(wrapDegrees(540)).toBe(180);
    expect(wrapDegrees(-190)).toBe(170);
  });

  it('keeps zoom inside its bounds', () => {
    expect(canvas3dOrbitAfterZoom(orbit, 1000).zoom).toBe(CANVAS_3D_MAX_ZOOM);
    expect(canvas3dOrbitAfterZoom(orbit, 0.00001).zoom).toBe(CANVAS_3D_MIN_ZOOM);
    expect(canvas3dOrbitAfterZoom(orbit, Number.NaN).zoom).toBe(1);
  });

  it('zooms in when the wheel scrolls up and out when it scrolls down', () => {
    expect(canvas3dZoomFactorFromWheel(-100)).toBeGreaterThan(1);
    expect(canvas3dZoomFactorFromWheel(100)).toBeLessThan(1);
    // A single violent trackpad flick must not swallow the whole zoom range.
    expect(canvas3dZoomFactorFromWheel(-100_000)).toBeLessThan(2);
  });

  it('applies scale before rotation so perspective stays constant', () => {
    expect(canvas3dStageTransform({ yaw: -26, pitch: 16, zoom: 0.42 }))
      .toBe('scale(0.42) rotateX(16deg) rotateY(-26deg)');
  });
});
