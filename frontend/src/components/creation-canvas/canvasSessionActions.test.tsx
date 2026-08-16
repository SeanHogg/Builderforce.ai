import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

// The copy IS the assertion here, exactly as it is for the surface switcher: a session
// bar whose buttons are named "creationCanvas.undoCanvasChange" tells nobody what they
// do. One shared resolver, so this file cannot drift from the catalog the app ships.
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

import {
  CANVAS_SESSION_ACTIONS,
  canvasSessionActionsFor,
  canvasSessionClusters,
  PHONE_SESSION_BAR_LIMIT,
  phoneOverflowActions,
  phoneSessionBarActions,
} from '@/lib/canvasSessionActions';
import { CANVAS_SURFACES, canvasSurfaceDefinition } from '@/lib/canvasSurfaces';
import enMessages from '@/i18n/messages/en.json';
import { CreationCanvas } from './CreationCanvas';

/**
 * The other half of the session bar: what you can DO to the canvas you are on.
 *
 * These assert the two properties the registry exists to guarantee — that an action
 * cannot fall off a small screen by omission, and that the invite panel has exactly one
 * door. Both used to be true only by accident, and one of them was not true at all.
 */

const CANVAS_COPY = (enMessages as { creationCanvas: Record<string, unknown> }).creationCanvas;

describe('canvas session action registry', () => {
  it('declares every action exactly once, with a unique order', () => {
    const ids = CANVAS_SESSION_ACTIONS.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(CANVAS_SESSION_ACTIONS.map((def) => def.order)).size).toBe(ids.length);
  });

  /**
   * THE ONE THIS FILE EXISTS FOR. A phone used to lose undo, redo, diagnostics, the
   * outcome scorecard and every route to the invite panel to a blanket `display:none` on
   * a class name — five actions, none of them declared missing anywhere. Placement is
   * data now, so "reachable on a phone" is something the registry can be asked.
   */
  it('leaves no action unreachable on a phone', () => {
    const bar = phoneSessionBarActions().map((def) => def.id);
    const menu = phoneOverflowActions().map((def) => def.id);

    // Complements: no action in both (two controls for one thing) and none in neither.
    expect(bar.filter((id) => menu.includes(id))).toEqual([]);
    expect([...bar, ...menu].sort()).toEqual(CANVAS_SESSION_ACTIONS.map((def) => def.id).sort());

    // A phone session bar is a title, an overflow button and a save button before any of
    // these are added. Past two, the title is what gets squeezed out — which is the one
    // thing in the bar that says which canvas you are on.
    expect(bar.length).toBeLessThanOrEqual(PHONE_SESSION_BAR_LIMIT);
    // Undo keeps a slot on purpose: a fat-fingered drag on a touch board is the likeliest
    // thing to need taking back, and burying the cure two taps deep makes a canvas feel
    // unsafe to touch. Full screen keeps the other: a small screen is where trading app
    // chrome for board is worth the most.
    expect(bar).toEqual(['undo', 'fullscreen']);
  });

  /**
   * THE SECOND ONE THIS FILE EXISTS FOR. The bar used to be the same eight buttons on
   * every surface, which put "read the outcome numbers for this board" and "run the
   * canvas diagnostics" on a conversation that has no objects on it — two controls whose
   * only possible answer is nothing.
   *
   * The fix is a REQUIREMENT, not a list of surfaces: an action says it needs objects and
   * the surface registry answers from `showsObjects`, which every surface already
   * declares. That is what this asserts — including the property that makes it worth
   * doing, that a surface nobody has added yet composes correctly without editing here.
   */
  it('drops the actions a surface cannot answer, from what the surface declares', () => {
    const on = (surface: Parameters<typeof canvasSessionActionsFor>[0]) =>
      canvasSessionActionsFor(surface).map((def) => def.id);

    // The board and the 3D space draw objects, so the outcome scorecard belongs on both.
    expect(on('graph')).toContain('outcomes');
    expect(on('scene3d')).toContain('outcomes');

    // Chat is the zero-object surface, and the app surface draws a running app rather
    // than the board's objects. Neither has deliverables to score.
    expect(on('chat')).not.toContain('outcomes');
    expect(on('app')).not.toContain('outcomes');

    // What survives everywhere is what means the same thing everywhere — and
    // DIAGNOSTICS IS ONE OF THEM. It reports the session: versions, timings, the action
    // log, the Brain trace and every failed call. All of that exists on a conversation
    // with no objects and on a running app that has hidden the board, and those are
    // exactly the surfaces where something has gone wrong and the report is wanted.
    // Scoping it to `showsObjects` took the failure report away from two of the four
    // places a failure is most likely to be looked for; this is the regression guard.
    for (const surface of CANVAS_SURFACES) {
      expect(on(surface.id)).toContain('diagnostics');
    }
    for (const surface of ['chat', 'graph', 'scene3d', 'app'] as const) {
      expect(on(surface)).toEqual(expect.arrayContaining(['undo', 'redo', 'fullscreen', 'share', 'publish']));
    }

    // Derived, not hand-listed: every action kept is one the surface can answer.
    for (const surface of CANVAS_SURFACES) {
      const def = canvasSurfaceDefinition(surface.id);
      for (const action of canvasSessionActionsFor(surface.id)) {
        if (action.needs === 'objects') expect(def.showsObjects).toBe(true);
        if (action.needs === 'board') expect(def.showsBoard).toBe(true);
      }
    }
  });

  /** The phone split has to survive the filter: an action hidden on this surface must
   *  not still be counted against the two-button budget, and one that IS shown must
   *  still land in exactly one of bar or sheet. */
  it('keeps the phone bar and the overflow sheet complementary on every surface', () => {
    for (const surface of CANVAS_SURFACES) {
      const bar = phoneSessionBarActions(surface.id).map((def) => def.id);
      const menu = phoneOverflowActions(surface.id).map((def) => def.id);
      expect(bar.filter((id) => menu.includes(id))).toEqual([]);
      expect([...bar, ...menu].sort()).toEqual(canvasSessionActionsFor(surface.id).map((def) => def.id).sort());
      expect(bar.length).toBeLessThanOrEqual(PHONE_SESSION_BAR_LIMIT);
    }
  });

  /** A cluster is a trough, and a trough is what says "these are the same kind of
   *  thing". Contiguity is what makes the grouping visible rather than merely intended. */
  it('groups the bar into contiguous clusters that each have a name', () => {
    const clusters = canvasSessionClusters();
    // Every action lands in exactly one cluster, in declaration order.
    expect(clusters.flatMap((group) => group.actions.map((def) => def.id)))
      .toEqual([...CANVAS_SESSION_ACTIONS].sort((a, b) => a.order - b.order).map((def) => def.id));
    // A cluster appears once: an id that came back twice means the orders interleave two
    // sets, which draws one of them as two troughs with a gap between them.
    const names = clusters.map((group) => group.cluster);
    expect(new Set(names).size).toBe(names.length);

    // Every cluster that draws a trough carries a real, translated group name.
    const clusterCopy = CANVAS_COPY.sessionActionCluster as Record<string, string>;
    for (const group of clusters) {
      expect(typeof clusterCopy[group.cluster]).toBe('string');
      expect(clusterCopy[group.cluster]).not.toMatch(/^creationCanvas\./);
    }
  });

  /** The label keys are pointers at copy that already exists — a registry that invented a
   *  second wording for "Undo canvas change" would put two strings behind one button. */
  it('names every action from the shipped catalog', () => {
    for (const def of CANVAS_SESSION_ACTIONS) {
      for (const key of [def.labelKey, def.activeLabelKey, def.titleKey]) {
        if (!key) continue;
        expect(typeof CANVAS_COPY[key]).toBe('string');
      }
    }
  });
});

describe('the session actions on the canvas', () => {
  const bar = () => screen.getByRole('group', { name: 'Canvas history' }).parentElement!;

  /**
   * The grouping the bar was missing. Undo/redo were segmented and the three view actions
   * beside them were not, so five icons of equal weight said nothing about which belonged
   * with which. The assertion is on the group, not on a class name — a hashed CSS-module
   * class is not what a future refactor has to keep true.
   */
  it('draws the history commands as one named group', () => {
    render(<CreationCanvas sessionId="session-actions-cluster-test" persistence="local" />);
    const history = screen.getByRole('group', { name: 'Canvas history' });
    expect(within(history).getByRole('button', { name: 'Undo canvas change' })).toBeInTheDocument();
    expect(within(history).getByRole('button', { name: 'Redo canvas change' })).toBeInTheDocument();
    // …and the view commands are a DIFFERENT group, not four more buttons in this one.
    const tools = screen.getByRole('group', { name: 'Canvas tools' });
    expect(within(tools).getByRole('button', { name: 'View outcome metrics' })).toBeInTheDocument();
    expect(within(tools).getByRole('button', { name: 'Full screen' })).toBeInTheDocument();
    expect(within(history).queryByRole('button', { name: 'Full screen' })).toBeNull();
    expect(bar()).toContainElement(tools);
  });

  /**
   * The phone's route to everything the bar had no room for. This is the assertion that
   * would have failed before the registry: the sheet listed templates, drawing and Miro,
   * and not one of the five actions the phone breakpoint had just hidden.
   */
  it('carries every phone-overflow action in the ••• sheet', () => {
    render(<CreationCanvas sessionId="session-actions-overflow-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'More session actions' }));

    const sheet = screen.getByTestId('canvas-more-menu');
    for (const def of phoneOverflowActions()) {
      const label = (CANVAS_COPY[def.labelKey] as string);
      expect(within(sheet).getByRole('button', { name: label })).toBeInTheDocument();
    }
    // Sanity: the sheet carries the overflow, not a second copy of the whole bar.
    expect(within(sheet).queryByRole('button', { name: 'Undo canvas change' })).toBeNull();
  });

  /**
   * ONE DOOR. The collaborator roster's `+` and the Share button opened the same invite
   * panel — one decision with two controls, which is the exact failure the surface
   * registry was written to prevent, repeated on the other half of the same bar.
   */
  it('opens the invite panel from Share and from nowhere else', () => {
    render(<CreationCanvas sessionId="session-actions-share-door-test" persistence="local" />);

    const roster = screen.getByLabelText('Active collaborators');
    expect(within(roster).queryByRole('button', { name: 'Invite collaborator' })).toBeNull();

    const share = screen.getByRole('button', { name: 'Share' });
    expect(share).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(share);
    expect(screen.getByRole('dialog', { name: 'Invite collaborators' })).toBeInTheDocument();
    // The button reports the panel it owns, so nothing else has to explain where the
    // sheet came from.
    expect(screen.getByRole('button', { name: 'Share' })).toHaveAttribute('aria-expanded', 'true');
  });

  /** Acting from the sheet dismisses the sheet — a menu that stays open over the panel it
   *  just opened is a menu in the way. */
  it('closes the ••• sheet when one of its session actions runs', () => {
    render(<CreationCanvas sessionId="session-actions-dismiss-test" persistence="local" />);
    fireEvent.click(screen.getByRole('button', { name: 'More session actions' }));

    const sheet = screen.getByTestId('canvas-more-menu');
    fireEvent.click(within(sheet).getByRole('button', { name: 'View outcome metrics' }));

    expect(screen.queryByTestId('canvas-more-menu')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Session outcome metrics' })).toBeInTheDocument();
  });
});

describe('the board rail', () => {
  /**
   * ONE rail on a phone, not two. The "add to canvas" toggle floated alone at the
   * top-left while the view commands stacked at the bottom-left — two toolbars down the
   * same edge of a 360px screen, with nothing saying why the add button was not part of
   * the set. They are siblings in one container now, and the toggle is its first command.
   */
  /**
   * MOVING AROUND THE BOARD IS NOT ON THE RAIL ANY MORE.
   *
   * Zoom, fit and arrange moved into the one command bar, which is where "what can I do
   * to this canvas" lives. The rail keeps only what the bar does not carry: the palette
   * toggle, the phone's surface switcher and the panels. Two floating toolbars each
   * holding half the view commands is the split this seam exists to prevent — so the
   * assertion is that there is exactly ONE of each, and that it is in the bar.
   */
  it('gives the view commands to the command bar and leaves the rail its panels', () => {
    render(<CreationCanvas sessionId="board-rail-test" persistence="local" />);

    for (const name of ['Zoom in', 'Zoom out', 'Fit canvas to view', 'Arrange canvas objects']) {
      const buttons = screen.getAllByRole('button', { name });
      expect(buttons).toHaveLength(1);
      expect(buttons[0].closest('[data-testid="canvas-command-bar"]')).not.toBeNull();
    }

    // The palette toggle stays on the rail — it drops objects ONTO the board, which is a
    // board gesture rather than a session command — and there is still exactly one of it.
    expect(screen.getAllByRole('button', { name: 'Toggle object palette' })).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Canvas panels' })).toBeInTheDocument();
  });
});
