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
} from '@/lib/canvasSessionActions';
import { CANVAS_SURFACES, canvasSurfaceDefinition } from '@/lib/canvasSurfaces';
import { CANVAS_BAR_GROUP_ORDER, canvasBarGroup } from '@/lib/canvasBarGroups';
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

/**
 * A `labelKey` resolved the way next-intl resolves it — by PATH.
 *
 * This was a flat index, which quietly assumed every action's copy sits at the top
 * of the `creationCanvas` namespace. That is an accident of the eleven actions that
 * happened to exist, not the property these tests are guarding: the invariant is
 * that every action IS named in the shipped catalog, and an action whose copy lives
 * with the rest of its feature (`walkthrough.action`) satisfies it just as well.
 * The flat lookup returned `undefined` for one, which then matched every unnamed
 * button in the sheet — a guard failing for a reason that had nothing to do with
 * what it exists to catch.
 */
function canvasCopy(key: string): unknown {
  return key.split('.').reduce<unknown>(
    (current, segment) => (current && typeof current === 'object' ? (current as Record<string, unknown>)[segment] : undefined),
    CANVAS_COPY,
  );
}

describe('canvas session action registry', () => {
  it('declares every action exactly once, with a unique order', () => {
    const ids = CANVAS_SESSION_ACTIONS.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(CANVAS_SESSION_ACTIONS.map((def) => def.order)).size).toBe(ids.length);
  });

  /**
   * THE ONE THIS FILE EXISTS FOR, restated for a phone that no longer has a bar.
   *
   * A phone used to lose undo, redo, diagnostics, the outcome scorecard and every route
   * to the invite panel to a blanket `display:none` on a class name — five actions, none
   * of them declared missing anywhere. The first fix declared PLACEMENT as data
   * (`phone: 'bar' | 'menu'`) and asserted the two halves were complements.
   *
   * The second fix removed the question. There is no phone command bar to split a list
   * across: the composer's "+" opens ONE sheet built from this registry. So the property
   * to guard is no longer "the two sets are complements" but the simpler one underneath
   * it — every action a surface offers is reachable, from one place, with a name. The
   * rendered half of that is in `the session actions on the canvas` below.
   */
  it('offers every action a surface can answer, with nothing filed as unreachable', () => {
    for (const surface of CANVAS_SURFACES) {
      const offered = canvasSessionActionsFor(surface.id);
      // No duplicates: one entry per action, so a sheet built from this cannot draw one
      // command twice.
      expect(new Set(offered.map((def) => def.id)).size).toBe(offered.length);
      // Every one of them is NAMED — the phone sheet words every tile, and a tile whose
      // label resolved to a dotted key is a tile nobody can read.
      for (const def of offered) expect(typeof canvasCopy(def.labelKey)).toBe('string');
    }
    // Nothing carries a placement axis any more; the field is gone from the type, and
    // this is the guard that it does not creep back as an untyped property.
    for (const def of CANVAS_SESSION_ACTIONS) {
      expect(def).not.toHaveProperty('phone');
    }
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

    // The board draws objects, so the outcome scorecard belongs on it. The room does
    // not — its session is a diorama until it is opened, and a scorecard floating over
    // a standup would be a control for something nobody in the room can act on.
    expect(on('graph')).toContain('outcomes');
    expect(on('room')).not.toContain('outcomes');

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
    for (const surface of ['chat', 'graph', 'room', 'app'] as const) {
      expect(on(surface)).toEqual(expect.arrayContaining(['undo', 'redo', 'fullscreen', 'share', 'publish']));
    }

    // THE CALL IS EVERY MODALITY'S. A conversation is as callable as a board, a 3D space
    // or a running app — the room is anchored to the CANVAS, not to what you are reading
    // it through — so it needs nothing from the surface and survives on all of them,
    // including any added later.
    for (const surface of CANVAS_SURFACES) {
      expect(on(surface.id)).toContain('call');
      // …and the standup beside it: a meeting about the canvas is not a feature of
      // the room, so it is offered wherever the call is.
      expect(on(surface.id)).toContain('standup');
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

    // Every cluster that draws a trough carries a real, translated group name — read from
    // the GROUP registry, which is the one place a group is named now. The clusters used
    // to carry a `sessionActionCluster.*` string of their own beside the caption's
    // `barGroup.*`, which is two strings behind one set of buttons.
    for (const group of clusters) {
      const label = canvasCopy(canvasBarGroup(group.cluster).labelKey);
      expect(typeof label, group.cluster).toBe('string');
      expect(label as string).not.toMatch(/^creationCanvas\./);
    }
  });

  /** The label keys are pointers at copy that already exists — a registry that invented a
   *  second wording for "Undo canvas change" would put two strings behind one button. */
  it('names every action from the shipped catalog', () => {
    for (const def of CANVAS_SESSION_ACTIONS) {
      for (const key of [def.labelKey, def.activeLabelKey, def.titleKey]) {
        if (!key) continue;
        expect(typeof canvasCopy(key)).toBe('string');
      }
    }
  });
});

describe('the session actions on the canvas', () => {
  const bar = () => screen.getByTestId('canvas-command-bar');

  /**
   * The grouping the bar was missing. Undo/redo were segmented and the three view actions
   * beside them were not, so five icons of equal weight said nothing about which belonged
   * with which. The assertion is on the group, not on a class name — a hashed CSS-module
   * class is not what a future refactor has to keep true.
   */
  it('files each command under the stage of the arc it serves', () => {
    render(<CreationCanvas sessionId="session-actions-cluster-test" persistence="local" />);

    // Shaping what is on the board is MAKE.
    const make = screen.getByRole('group', { name: 'Make — shape what is on the board' });
    expect(within(make).getByRole('button', { name: 'Undo canvas change' })).toBeInTheDocument();
    expect(within(make).getByRole('button', { name: 'Redo canvas change' })).toBeInTheDocument();

    // Reading the board is MEASURE, and it is a DIFFERENT group — not four more buttons
    // in the one beside it, which is what `Tools` had become.
    const measure = screen.getByRole('group', { name: 'Measure — read how it is doing' });
    expect(within(measure).getByRole('button', { name: 'View outcome metrics' })).toBeInTheDocument();
    expect(bar()).toContainElement(measure);

    // FULL SCREEN IS IN NEITHER. It answers no stage's question — it is done to the
    // board, not to the work — so it sits in the one group that names no stage. Filing it
    // under `Tools` beside the diagnostics report is exactly how that shelf formed.
    const board = screen.getByRole('group', { name: 'This board' });
    expect(within(board).getByRole('button', { name: 'Full screen' })).toBeInTheDocument();
    expect(within(measure).queryByRole('button', { name: 'Full screen' })).toBeNull();
    expect(within(make).queryByRole('button', { name: 'Full screen' })).toBeNull();
  });

  /**
   * THE PHONE'S COMMAND BAR, AS ONE SHEET.
   *
   * This used to assert "the ••• sheet carries exactly the complement of the phone bar",
   * which was the right guard while a 360px bar held two buttons and the sheet held the
   * rest. There is no phone bar now — the composer's "+" opens this sheet, and the
   * property worth guarding is the stronger one: EVERY action the surface offers is in
   * it, including the doors out and the roster's Share, which the old overflow
   * deliberately excluded because they had a second home on the bar.
   *
   * It is rendered by opening the trigger directly rather than at a phone width, because
   * jsdom has no viewport: `usePhoneViewport` answers `false` here, which is exactly the
   * desktop arrangement, and the sheet is the same component either way.
   */
  it('carries every registry action for the surface in the actions sheet', () => {
    render(<CreationCanvas sessionId="session-actions-sheet-test" persistence="local" />);

    // Several actions (`run`, `outcomes`, `prove`) declare `needs: 'objects'` and the
    // host withdraws them at runtime until the canvas actually holds one — a different
    // question from whether the surface can carry objects at all.
    fireEvent.click(screen.getByRole('button', { name: 'Add to the board' }));
    fireEvent.click(screen.getByTestId('canvas-picker-task'));

    fireEvent.click(screen.getByTestId('canvas-actions-trigger'));
    const sheet = screen.getByTestId('canvas-actions-sheet');

    for (const def of canvasSessionActionsFor('graph')) {
      // A local board withdraws Prove rather than gating it — the header already offers
      // "Keep your work" for the same canvas. The registry still lists it; the host does
      // not. Assert the withdrawal below instead of treating the registry as the sheet.
      if (def.id === 'prove') continue;
      const label = canvasCopy(def.labelKey) as string;
      expect(within(sheet).getByRole('button', { name: label }), def.id).toBeInTheDocument();
    }
    // The doors out are IN it — they were the one thing the old overflow left out,
    // because they had a worded button of their own on a bar a phone no longer draws.
    expect(within(sheet).getByRole('button', { name: 'Publish' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Prove it' })).toBeNull();
    // …under the SAME arc captions the desktop bar uses, resolved by the same component,
    // so the two chromes cannot drift into two vocabularies for one set of groups — and
    // in the SAME order the bar walks them (`CANVAS_BAR_GROUP_ORDER`).
    const groups = within(sheet).getAllByRole('group')
      .map((el) => el.getAttribute('data-group'))
      .filter((id): id is string => Boolean(id));
    expect(groups).toEqual([...CANVAS_BAR_GROUP_ORDER]);
  });

  /** A sheet is responsible for being closable — from its own header and on Escape.
   *  Both come from being a `CanvasMenuSheet`, which is why the actions sheet gets them
   *  by construction rather than by remembering to add them. */
  it('closes the actions sheet from its header and on Escape', () => {
    render(<CreationCanvas sessionId="session-actions-sheet-close-test" persistence="local" />);

    fireEvent.click(screen.getByTestId('canvas-actions-trigger'));
    fireEvent.click(within(screen.getByTestId('canvas-actions-sheet')).getByRole('button', { name: 'Close Actions' }));
    expect(screen.queryByTestId('canvas-actions-sheet')).toBeNull();

    fireEvent.click(screen.getByTestId('canvas-actions-trigger'));
    expect(screen.getByTestId('canvas-actions-sheet')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('canvas-actions-sheet')).toBeNull();
  });

  /**
   * THE CALL IS IN THE BAR, ON EVERY SURFACE — and its dock is not.
   *
   * Starting a call used to be a dormant band across the bottom of the shell: chrome of
   * its own, on every canvas, for a call almost nobody was about to make, and the one
   * canvas action that lived nowhere near the others. It is a registry action now, so it
   * is wherever the rest of them are.
   *
   * A local board with no shared session has no room to open, so the control is drawn and
   * inert rather than absent — "you cannot call from here yet" is a thing the bar should
   * say, and a missing button says nothing.
   */
  it('offers the call from the command bar on a canvas with no room, and draws no dock', () => {
    render(<CreationCanvas sessionId="session-actions-call-test" persistence="local" />);

    const call = within(screen.getByTestId('canvas-command-bar')).getByRole('button', { name: 'Start call' });
    expect(call).toBeDisabled();
    // Session actions live on the command bar (and the phone's "+" sheet), not in the
    // board menu — that sheet is board errands only. A local canvas with no room still
    // draws the control inert rather than absent.
    expect(screen.queryByTestId('canvas-more-menu')).toBeNull();
    // The dock belongs to a RUNNING call. Nothing about an idle canvas may reserve the
    // band it occupies, which is the whole reason the dormant strip went.
    expect(screen.queryByRole('region', { name: 'Live session' })).toBeNull();
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

    const share = screen.getByRole('button', { name: 'Invite collaborators' });
    expect(share).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(share);
    expect(screen.getByRole('dialog', { name: 'Invite collaborators' })).toBeInTheDocument();
    // The button reports the panel it owns, so nothing else has to explain where the
    // sheet came from.
    expect(screen.getByRole('button', { name: 'Invite collaborators' })).toHaveAttribute('aria-expanded', 'true');
  });

  /** Acting from the sheet dismisses the sheet — a menu that stays open over the panel it
   *  just opened is a menu in the way. */
  it('closes the actions sheet when one of its session actions runs', () => {
    render(<CreationCanvas sessionId="session-actions-dismiss-test" persistence="local" />);
    fireEvent.click(screen.getByTestId('canvas-actions-trigger'));

    const sheet = screen.getByTestId('canvas-actions-sheet');
    fireEvent.click(within(sheet).getByRole('button', { name: 'View outcome metrics' }));

    expect(screen.queryByTestId('canvas-actions-sheet')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Session outcome metrics' })).toBeInTheDocument();
  });

  /**
   * THE WAY OUT OF A SHEET THAT MOSTLY DOES NOT CLOSE.
   *
   * Most of what the ••• sheet holds deliberately leaves it open — the view trough is
   * pressed repeatedly, and the connector selects are returned to — so a person who
   * opened it to change a line style had nothing in front of them that said "done", and
   * the button that would have closed it was underneath the sheet they were reading.
   * Both bar sheets carry the same header now, because it belongs to being a sheet.
   */
  it('closes either bar sheet from its own header, and on Escape', () => {
    render(<CreationCanvas sessionId="session-actions-sheet-close-test" persistence="local" />);

    fireEvent.click(screen.getByRole('button', { name: 'More session actions' }));
    const sheet = screen.getByTestId('canvas-more-menu');
    // The close button names what it closes rather than saying "Close".
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close More session actions' }));
    expect(screen.queryByTestId('canvas-more-menu')).toBeNull();

    // Escape leaves the sheet WITHOUT reaching the board's own Escape, which clears the
    // selection — one press must not be two undos.
    fireEvent.click(screen.getByRole('button', { name: 'More session actions' }));
    expect(screen.getByTestId('canvas-more-menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('canvas-more-menu')).toBeNull();

    // The same header on the other sheet, so a second sheet cannot ship without a way out.
    fireEvent.click(screen.getByTestId('canvas-make-it-real'));
    const doors = screen.getByTestId('canvas-make-it-real-menu');
    fireEvent.click(within(doors).getByRole('button', { name: 'Close Make it real' }));
    expect(screen.queryByTestId('canvas-make-it-real-menu')).toBeNull();
  });
});

describe('the board rail', () => {
  /**
   * MOVING AROUND THE BOARD IS NOT ON THE RAIL ANY MORE — and neither is the rail.
   *
   * Zoom, fit and arrange moved into the one command bar, which is where "what can I do
   * to this canvas" lives. "Add to canvas" used to float as a second, top-left toggle on
   * the rail — a second door onto the exact same picker the bar's own button already
   * opens — which is the split this seam exists to prevent, so that toggle is gone and
   * the bar's button is the ONE way in. The last thing on the rail was the phone's surface
   * switcher, and that is a worded STRIP under the canvas app bar now — so there is no
   * floating rail left at any width.
   */
  it('gives add-to-canvas to the bar and the view commands to the board menu, and keeps no floating rail', () => {
    render(<CreationCanvas sessionId="board-rail-test" persistence="local" />);

    // ONE door onto the palette, and it is on the bar, leading Idea.
    const add = screen.getAllByRole('button', { name: 'Add to the board' });
    expect(add).toHaveLength(1);
    expect(add[0].closest('[data-testid="canvas-command-bar"]')).not.toBeNull();

    // MOVING THE VIEWPORT IS NOT A STAGE OF ANYTHING, so it cannot be captioned by the
    // arc — and a floating pill in the corner would have put "what can I do here" back
    // into two places, which is what the rail was deleted for. The commands are a section
    // of the ••• sheet, reached from the one group that names no stage.
    for (const name of ['Zoom in', 'Zoom out', 'Arrange canvas objects']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    fireEvent.click(screen.getByRole('button', { name: 'More session actions' }));
    const tools = within(screen.getByTestId('canvas-more-menu')).getByRole('group', { name: 'Canvas view controls' });
    for (const name of ['Zoom in', 'Zoom out', 'Fit canvas to view', 'Arrange canvas objects']) {
      expect(within(tools).getByRole('button', { name })).toBeInTheDocument();
    }
    // Zoom is a control you press repeatedly. A sheet that closed under the second press
    // would be a sheet you cannot zoom with.
    fireEvent.click(within(tools).getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByTestId('canvas-more-menu')).toBeInTheDocument();

    // WHAT IS LEFT WHERE THE RAIL WAS: nothing. The phone's surface switcher was the
    // last thing on it — an icon column over the board's own heading — and it is a
    // worded strip under the canvas app bar now, in its own band.
    expect(screen.queryByRole('group', { name: 'Canvas panels' })).toBeNull();
    expect(screen.getByTestId('canvas-surface-strip')).toBeInTheDocument();
  });
});
