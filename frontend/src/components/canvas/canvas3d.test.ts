import { describe, expect, it } from 'vitest';
import {
  CANVAS_3D_DEFAULT_ORBIT,
  CANVAS_3D_LAYER_GAP,
  CANVAS_3D_MAX_PITCH,
  CANVAS_3D_MAX_ZOOM,
  CANVAS_3D_MIN_ZOOM,
  applyCanvas3DMoves,
  canvas3dAxes,
  canvas3dCameraTransform,
  canvas3dDepthOffset,
  canvas3dLinkTransform,
  canvas3dOrbitAfterDrag,
  canvas3dOrbitAfterZoom,
  canvas3dPanAfterDrag,
  canvas3dPanToCentre,
  canvas3dDepthFromDrag,
  canvas3dPerspectiveFactor,
  canvas3dScene,
  canvas3dUnprojectToPlane,
  canvas3dStageTransform,
  canvas3dZoomFactorFromWheel,
  wrapDegrees,
  type Canvas3DNode,
  type Canvas3DOrbit,
  type Canvas3DPoint,
} from './canvas3d';
import { graphLayerRanks } from './canvasGraph';

const node = (id: string, x: number, y: number, width = 200, height = 100): Canvas3DNode & { group: string } => ({
  id,
  position: { x, y },
  style: { width, height },
  group: id.startsWith('d') ? 'Data' : 'Build',
});

const describe3D = (candidate: Canvas3DNode & { group: string }) => ({ label: candidate.id, group: candidate.group });

/**
 * Where a point in the scene actually lands on screen — the CSS pipeline the
 * stage transform drives, written out so the drag solve can be checked against
 * the projection it claims to invert rather than against itself.
 */
const project = (orbit: Canvas3DOrbit, point: Canvas3DPoint): { x: number; y: number } => {
  const { u, v, w } = canvas3dAxes(orbit);
  const foreshorten = canvas3dPerspectiveFactor(u.z * point.x + v.z * point.y + w.z * point.z);
  return {
    x: orbit.panX + foreshorten * (u.x * point.x + v.x * point.y + w.x * point.z),
    y: orbit.panY + foreshorten * (u.y * point.x + v.y * point.y + w.y * point.z),
  };
};

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
  const orbit: Canvas3DOrbit = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 };

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
    expect(canvas3dStageTransform({ yaw: -26, pitch: 16, zoom: 0.42, panX: 0, panY: 0 }))
      .toBe('scale(0.42) rotateX(16deg) rotateY(-26deg)');
  });

  it('pans the camera rather than the scene, so travel stays 1:1 with the pointer', () => {
    expect(canvas3dCameraTransform(canvas3dPanAfterDrag({ ...orbit, zoom: 0.2 }, 40, -25)))
      .toBe('translate3d(40px, -25px, 0px)');
    expect(canvas3dPanAfterDrag(canvas3dPanAfterDrag(orbit, 10, 10), -4, 6)).toMatchObject({ panX: 6, panY: 16 });
    expect(canvas3dPanAfterDrag(orbit, Number.NaN, 5)).toMatchObject({ panX: 0, panY: 5 });
  });
});

describe('moving an object in the space', () => {
  const origin: Canvas3DPoint = { x: 0, y: 0, z: 0 };
  const flat: Canvas3DOrbit = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 };

  it('reads the pointer one board pixel per screen pixel, face on', () => {
    expect(canvas3dUnprojectToPlane(flat, { x: 30, y: -12 }, 0)).toMatchObject({ x: 30, y: -12 });
  });

  it('covers more board per pixel the further the user has zoomed out', () => {
    expect(canvas3dUnprojectToPlane({ ...flat, zoom: 0.5 }, { x: 30, y: 0 }, 0)!.x).toBeCloseTo(60, 6);
  });

  it('keeps the object exactly under the pointer at a turned, tilted, panned orbit', () => {
    const orbit: Canvas3DOrbit = { yaw: -37, pitch: 22, zoom: 0.55, panX: 120, panY: -60 };
    const plane = CANVAS_3D_LAYER_GAP;

    // Every one of these is a place an object could be dragged to. Projecting it
    // and reading it back has to return the same point, or the card slides out
    // from under the cursor as the drag goes on.
    for (const point of [{ x: 220, y: -140 }, { x: -680, y: 410 }, { x: 0, y: 0 }, { x: 1500, y: 1200 }]) {
      const at: Canvas3DPoint = { ...point, z: plane };
      const read = canvas3dUnprojectToPlane(orbit, project(orbit, at), plane);

      expect(read!.x).toBeCloseTo(point.x, 6);
      expect(read!.y).toBeCloseTo(point.y, 6);
    }
  });

  it('gives up rather than guessing when the plane is edge on to the pointer', () => {
    // Turned side on with no tilt, the plane projects to a line: the ray under
    // the cursor runs along it and meets it nowhere in particular.
    expect(canvas3dUnprojectToPlane({ yaw: 90, pitch: 0, zoom: 1, panX: 0, panY: 0 }, { x: 0, y: 40 }, 0)).toBeNull();
  });

  it('sends a depth drag toward the viewer when pulled up-screen, and away when pushed down', () => {
    expect(canvas3dDepthFromDrag(CANVAS_3D_DEFAULT_ORBIT, { dx: 0, dy: -40 }, origin)).toBeGreaterThan(0);
    expect(canvas3dDepthFromDrag(CANVAS_3D_DEFAULT_ORBIT, { dx: 0, dy: 40 }, origin)).toBeLessThan(0);
  });

  it('still moves through depth head on, where the depth axis has no screen direction', () => {
    // Face on, depth points straight at the camera: there is nothing to project
    // a drag onto, so the gesture falls back to the vertical rather than dying.
    expect(canvas3dDepthFromDrag(flat, { dx: 0, dy: -40 }, origin)).toBeCloseTo(40, 6);
  });

  it('measures a depth drag against how far depth actually runs on screen', () => {
    const orbit: Canvas3DOrbit = { yaw: -30, pitch: 18, zoom: 1, panX: 0, panY: 0 };
    const at: Canvas3DPoint = { x: 40, y: 40, z: 0 };
    const from = project(orbit, at);
    const to = project(orbit, { ...at, z: at.z + 60 });

    expect(canvas3dDepthFromDrag(orbit, { dx: to.x - from.x, dy: to.y - from.y }, at)).toBeCloseTo(60, 0);
  });

  it('reports no movement for a pointer that has not moved', () => {
    expect(canvas3dDepthFromDrag(CANVAS_3D_DEFAULT_ORBIT, { dx: 0, dy: 0 }, origin)).toBeCloseTo(0, 12);
  });

  it('pans so a chosen object lands in the middle of the viewport', () => {
    const orbit: Canvas3DOrbit = { yaw: -40, pitch: 20, zoom: 0.6, panX: 300, panY: 90 };
    const target: Canvas3DPoint = { x: -420, y: 260, z: CANVAS_3D_LAYER_GAP };
    const centred = canvas3dPanToCentre(orbit, target);

    expect(project(centred, target).x).toBeCloseTo(0, 6);
    expect(project(centred, target).y).toBeCloseTo(0, 6);
    // Only the camera moves — the object keeps its place in the space.
    expect(centred).toMatchObject({ yaw: -40, pitch: 20, zoom: 0.6 });
  });
});

describe('applyCanvas3DMoves', () => {
  const board = () => [
    { id: 'a', position: { x: 100, y: 200 }, data: { title: 'A' } },
    { id: 'b', position: { x: 0, y: 0 }, data: { title: 'B', depthOffset: 120 } },
  ];

  it('writes a move across the plane straight back to the board position', () => {
    const [moved] = applyCanvas3DMoves(board(), [{ id: 'a', dx: 40, dy: -15, dz: 0 }]);
    expect(moved).toMatchObject({ position: { x: 140, y: 185 } });
    // The object keeps everything else it knows about itself.
    expect(moved!.data).toMatchObject({ title: 'A' });
  });

  it('accumulates depth onto the lift the object is already carrying', () => {
    const moved = applyCanvas3DMoves(board(), [{ id: 'b', dx: 0, dy: 0, dz: -45 }]);
    expect(canvas3dDepthOffset(moved[1]!)).toBe(75);
  });

  it('drops the field entirely when an object settles back onto its layer', () => {
    const moved = applyCanvas3DMoves(board(), [{ id: 'b', dx: 0, dy: 0, dz: -120 }]);
    // Not zero — absent, so a settled object carries no stale lift into a save.
    expect(canvas3dDepthOffset(moved[1]!)).toBeUndefined();
    expect(moved[1]!.data.depthOffset).toBeUndefined();
  });

  it('never moves an object whose placement is locked', () => {
    const moved = applyCanvas3DMoves(
      board(),
      [{ id: 'a', dx: 40, dy: 40, dz: 40 }, { id: 'b', dx: 40, dy: 40, dz: 40 }],
      (node) => node.id !== 'a',
    );
    expect(moved[0]).toMatchObject({ position: { x: 100, y: 200 } });
    expect(canvas3dDepthOffset(moved[0]!)).toBeUndefined();
    expect(moved[1]).toMatchObject({ position: { x: 40, y: 40 } });
  });

  it('leaves objects nothing moved alone, and reads a lift only when it is a real number', () => {
    const nodes = board();
    expect(applyCanvas3DMoves(nodes, [])).toBe(nodes);
    expect(applyCanvas3DMoves(nodes, [{ id: 'missing', dx: 9, dy: 9, dz: 9 }])[0]).toBe(nodes[0]);
    expect(canvas3dDepthOffset({ data: { depthOffset: 'far' } })).toBeUndefined();
    expect(canvas3dDepthOffset({})).toBeUndefined();
  });
});

describe('objects lifted off their layer', () => {
  const lifted = (offsets: Record<string, number>) => canvas3dScene({
    nodes: [node('a', 0, 0), node('b', 400, 0), node('c', 800, 0)],
    edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }],
    describe: (candidate) => ({ label: candidate.id, group: candidate.group, depthOffset: offsets[candidate.id] }),
  });

  it('keeps the object where the user put it, with its layer left behind as a reference', () => {
    const card = lifted({ b: 120 }).cards.find((entry) => entry.id === 'b')!;

    expect(card.layerZ).toBe(0);
    expect(card.z).toBe(120);
    expect(card.layer).toBe(1);
  });

  it('sits an object with no offset of its own exactly on its layer', () => {
    for (const card of lifted({}).cards) expect(card.z).toBe(card.layerZ);
  });

  it('reads a connection between two lifted objects as travelling through depth', () => {
    const scene = canvas3dScene({
      nodes: [node('a', 0, 0), node('b', 400, 0)],
      edges: [{ source: 'a', target: 'b' }],
      // Same group, no dependency ordering to separate them: only the lift does.
      describe: (candidate) => ({ label: candidate.id, group: 'Build', depthOffset: candidate.id === 'b' ? 200 : 0 }),
      depthMode: 'group',
    });

    expect(scene.layers).toHaveLength(1);
    expect(scene.links[0]!.spansLayers).toBe(true);
  });

  it('ignores an offset that is not a real number', () => {
    const card = lifted({ b: Number.NaN }).cards.find((entry) => entry.id === 'b')!;
    expect(card.z).toBe(0);
  });

  it('carries a locked placement through to the card, so the space cannot move it', () => {
    const scene = canvas3dScene({
      nodes: [node('a', 0, 0), node('b', 400, 0)],
      edges: [],
      describe: (candidate) => ({ label: candidate.id, group: candidate.group, locked: candidate.id === 'a' }),
    });

    expect(scene.cards.find((card) => card.id === 'a')!.locked).toBe(true);
    expect(scene.cards.find((card) => card.id === 'b')!.locked).toBe(false);
  });
});
