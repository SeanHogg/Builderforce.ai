import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

// The copy IS the assertion here — a surface switcher whose entries are named
// "creationCanvas.surface.chat.label" tells nobody which surface they are on. One shared
// resolver, so this file cannot quietly drift from the one the app uses.
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

import {
  boardCanvasSurfaces,
  CANVAS_SURFACES,
  CANVAS_SURFACE_STORAGE_KEY,
  canvasSurfaceDefinition,
  DEFAULT_CANVAS_SURFACE,
  readCanvasSurface,
  sanitizeCanvasSurface,
  writeCanvasSurface,
} from '@/lib/canvasSurfaces';
import { creationObjectSurface } from './creationObjectSurfaces';
import { CanvasSurfaceRouter } from './CanvasSurfaceRouter';
import { CreationCanvas } from './CreationCanvas';

/**
 * The second extensibility axis: WHICH runtime the canvas mounts in its centre.
 *
 * These assert the two properties the seam exists to guarantee — that the decision has
 * exactly one owner, and that a surface which IS the conversation never puts a second
 * live transcript on screen beside it.
 */

describe('canvas surface registry', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('declares every surface exactly once, with a unique order', () => {
    const ids = CANVAS_SURFACES.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(CANVAS_SURFACES.map((def) => def.order)).size).toBe(ids.length);
    // The board is the default, and it is the only surface that draws one.
    expect(canvasSurfaceDefinition(DEFAULT_CANVAS_SURFACE).showsBoard).toBe(true);
    expect(CANVAS_SURFACES.filter((def) => def.showsBoard).map((def) => def.id)).toEqual(['graph']);
    // "no flat board" and "no objects" are different questions — the 3D space answers
    // them differently, which is why the chrome that asks them reads two flags.
    expect(CANVAS_SURFACES.filter((def) => def.showsObjects).map((def) => def.id)).toEqual(['graph', 'scene3d']);
  });

  /**
   * An object surface is a surface OF something, so it cannot be offered by a control that
   * has no object in hand, and cannot be restored on a reload that has forgotten which.
   * Both rules are the `scope` field, read rather than re-derived at each call site.
   */
  it('keeps object-scoped surfaces out of the rail and out of the stored preference', () => {
    const objectScoped = CANVAS_SURFACES.filter((def) => def.scope === 'object');
    expect(objectScoped.map((def) => def.id)).toEqual(['page', 'play', 'site', 'timeline']);
    // None persists: a page cannot be reopened without knowing which page.
    expect(objectScoped.every((def) => !def.persist)).toBe(true);
    // None draws the board or its objects — each is about exactly one.
    expect(objectScoped.every((def) => !def.showsBoard && !def.showsObjects)).toBe(true);
    expect(boardCanvasSurfaces().map((def) => def.id)).toEqual(['chat', 'graph', 'scene3d']);
  });

  /** The join between the two axes: a kind declares the surface that authors it. */
  it('sends each medium to the runtime that can draw its axis, and nothing else', () => {
    expect(creationObjectSurface('resume')).toBe('page');
    expect(creationObjectSurface('prd')).toBe('page');
    expect(creationObjectSurface('game')).toBe('play');
    expect(creationObjectSurface('video')).toBe('timeline');
    expect(creationObjectSurface('voice')).toBe('timeline');
    // A site is pages AND a width — two axes a single sheet does not have, which is why
    // it is not folded into `page` however much both of them are "a document".
    expect(creationObjectSurface('website')).toBe('site');
    expect(creationObjectSurface('prototype')).toBe('site');
    expect(creationObjectSurface('document')).toBe('page');
    // A card IS the whole object for most kinds, and should stay that way.
    expect(creationObjectSurface('task')).toBeNull();
    expect(creationObjectSurface('sticky')).toBeNull();
    // Every declared target is a real, object-scoped surface.
    for (const def of CANVAS_SURFACES) {
      if (def.scope !== 'object') continue;
      expect(boardCanvasSurfaces().some((board) => board.id === def.id)).toBe(false);
    }
  });

  it('degrades an unknown surface to the board rather than to a blank centre', () => {
    // A string that is NOT a declared surface. This used to be 'timeline', which was
    // then promoted to a real object-scoped surface — so the assertion quietly started
    // testing that a valid id sanitizes to itself, which is the opposite of the rule.
    // Every id here must stay one the registry can never declare.
    expect(sanitizeCanvasSurface('not-a-surface')).toBe(DEFAULT_CANVAS_SURFACE);
    expect(sanitizeCanvasSurface(null)).toBe(DEFAULT_CANVAS_SURFACE);
    expect(canvasSurfaceDefinition('nope' as 'graph').id).toBe(DEFAULT_CANVAS_SURFACE);
    // …and a surface that IS declared survives, so the guard above cannot pass by
    // sanitizing everything to the board.
    expect(sanitizeCanvasSurface('timeline')).toBe('timeline');
  });

  /**
   * A place is remembered; a PROJECTION of the board you were already on is not. Coming
   * back to a canvas silently rotated into 3D reads as a bug, and the rule lives in the
   * registry so no call site has to know which surfaces are which.
   */
  it('remembers a surface the visitor chose and forgets one they only looked through', () => {
    writeCanvasSurface('chat');
    expect(window.localStorage.getItem(CANVAS_SURFACE_STORAGE_KEY)).toBe('chat');
    expect(readCanvasSurface()).toBe('chat');

    writeCanvasSurface('scene3d');
    // Unwritten, so the last PLACE survives rather than being overwritten by a reading.
    expect(window.localStorage.getItem(CANVAS_SURFACE_STORAGE_KEY)).toBe('chat');

    window.localStorage.setItem(CANVAS_SURFACE_STORAGE_KEY, 'scene3d');
    expect(readCanvasSurface()).toBe(DEFAULT_CANVAS_SURFACE);
  });
});

describe('CanvasSurfaceRouter', () => {
  it('mounts the surface for the active id and nothing at all for the board', () => {
    const surfaces = { chat: <p>conversation</p>, scene3d: <p>space</p> };
    const { container, rerender } = render(<CanvasSurfaceRouter surface="chat" surfaces={surfaces} />);
    expect(container.textContent).toBe('conversation');

    rerender(<CanvasSurfaceRouter surface="scene3d" surfaces={surfaces} />);
    expect(container.textContent).toBe('space');

    // The board is the React Flow tree the host always renders; there is nothing to
    // put on top of it, so the router contributes nothing rather than an empty shell.
    rerender(<CanvasSurfaceRouter surface="graph" surfaces={surfaces} />);
    expect(container.textContent).toBe('');
  });

  it('falls back to the board when a declared surface has no runtime yet', () => {
    const { container } = render(<CanvasSurfaceRouter surface="scene3d" surfaces={{ chat: <p>conversation</p> }} />);
    expect(container.textContent).toBe('');
  });
});

describe('the chat surface on the canvas', () => {
  beforeEach(() => { window.localStorage.clear(); });

  /**
   * The surface switcher, and the ONE way these tests reach a surface button.
   *
   * `screen.getAllByRole('button', { name })` computes an accessible name for every
   * button in the document, and a mounted canvas has the whole palette in it — measured
   * at 7–10s per test that used it, and 16s for the one below that called it twelve
   * times, against a 60s ceiling. Scoping to the group the switcher already declares
   * turns each of those into a handful of nodes: same control, same assertion, ~10x less
   * work. (`puts the surface decision in the session header` is what proves the buttons
   * are in this group and nowhere else, so scoping here asserts nothing away.)
   */
  const switcher = () => screen.getByRole('group', { name: 'Canvas view' });
  const surfaceButton = (name: string) => within(switcher()).getByRole('button', { name });

  /**
   * The whole point of the placement: chat is the canvas with the board stood down, not
   * a second product. So exactly ONE transcript is on screen — the edge dock stands down
   * rather than narrating the same conversation twice — and the board is one press away
   * with a live count of what the conversation has already put on it.
   */
  it('replaces the board with the conversation and keeps exactly one transcript', () => {
    render(<CreationCanvas sessionId="surface-chat-test" persistence="local" />);
    const board = () => document.querySelector<HTMLElement>('[data-view]')!;

    expect(board()).toHaveAttribute('data-view', 'graph');
    expect(screen.getByRole('log', { name: 'Brain chat history' })).toBeInTheDocument();

    fireEvent.click(surfaceButton('Chat'));

    expect(board()).toHaveAttribute('data-view', 'chat');
    const surface = screen.getByTestId('canvas-chat-surface');
    // One transcript, and it is the one inside the surface.
    const transcripts = screen.getAllByRole('log', { name: 'Brain chat history' });
    expect(transcripts).toHaveLength(1);
    expect(surface).toContainElement(transcripts[0]!);
    // The prompt is a page fixture and stays put — the surface never grows its own.
    expect(screen.getByTestId('canvas-composer')).toBeInTheDocument();
    expect(within(surface).queryByTestId('canvas-composer')).not.toBeInTheDocument();
  });

  /**
   * The control that offers to move the conversation into the Brain Object reads the
   * active surface, so it stands down when there is no board on screen to move it into.
   * It used to infer that from whether a 3D scene was publishing commands — an answer
   * that was only accidentally right, and wrong the moment a second boardless surface
   * existed.
   */
  it('stops offering to move the conversation into an Object that is not on screen', () => {
    render(<CreationCanvas sessionId="surface-chat-placement-test" persistence="local" />);
    // By its LABEL, not by role+name. The control carries an explicit `aria-label`, so
    // this resolves through an attribute selector; the role query it replaces built an
    // accessible name for every button on a mounted canvas, twice, and cost 9.8s of the
    // file's runtime on its own. Same element, same accessible name, same assertion.
    const moveIntoObject = () => screen.queryByLabelText('Show the chat in the Brain object');
    expect(moveIntoObject()).toBeInTheDocument();

    fireEvent.click(surfaceButton('Chat'));
    expect(moveIntoObject()).not.toBeInTheDocument();
  });

  it('hands the board back from inside the conversation, and remembers the choice', () => {
    render(<CreationCanvas sessionId="surface-chat-return-test" persistence="local" />);

    fireEvent.click(surfaceButton('Chat'));
    expect(window.localStorage.getItem(CANVAS_SURFACE_STORAGE_KEY)).toBe('chat');

    const surface = screen.getByTestId('canvas-chat-surface');
    fireEvent.click(within(surface).getByRole('button', { name: /Open the board/ }));

    expect(document.querySelector('[data-view]')).toHaveAttribute('data-view', 'graph');
    expect(screen.queryByTestId('canvas-chat-surface')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(CANVAS_SURFACE_STORAGE_KEY)).toBe('graph');
  });

  /**
   * The switcher lists BOARD surfaces. If an object surface leaked into it, pressing it
   * with nothing selected would open a runtime with no object — a screen showing nothing.
   */
  it('never offers an object surface on the switcher', () => {
    render(<CreationCanvas sessionId="surface-rail-scope-test" persistence="local" />);
    // The switcher's WHOLE contents, in one read, rather than four name-filtered scans
    // of the entire canvas. Stronger as well as ~8x cheaper: an object surface leaking
    // in fails here whatever it is called — including a fifth nobody has added yet —
    // and the count is pinned to the board surfaces the registry declares, so adding a
    // board surface without a button (or a button without a surface) also fails.
    const offered = within(switcher()).getAllByRole('button').map((button) => button.textContent);
    expect(offered).toEqual(['Chat', 'Board', '3D space']);
    expect(offered).toHaveLength(boardCanvasSurfaces().length);
  });

  /**
   * WHERE the decision is made, not just that it can be. The three surfaces used to render
   * as unlabelled `ControlButton`s inside React Flow's zoom rail, at the same size and
   * weight as zoom-in and fit-view, which is why nobody found them. They now sit in the
   * session header as one named group with drawn labels.
   *
   * The assertions are on placement rather than on class names: a rule that reads "not
   * inside the rail" is what a future refactor has to keep true, and a hashed CSS-module
   * class is not.
   */
  it('puts the surface decision in the session header, not on the zoom rail', () => {
    render(<CreationCanvas sessionId="surface-placement-test" persistence="local" />);

    const group = screen.getByRole('group', { name: 'Canvas view' });
    for (const name of ['Chat', 'Board', '3D space']) {
      const button = within(group).getByRole('button', { name });
      // The label is DRAWN, not only announced — the whole defect was three glyphs that
      // said nothing about which one was a conversation.
      expect(button).toHaveTextContent(name);
      // …and never inside React Flow's own control rail.
      expect(button.closest('.react-flow__controls')).toBeNull();
    }
    // The rail keeps what it is actually for. If this ever finds a surface button again,
    // the switcher has been duplicated rather than moved.
    const rail = document.querySelector('.react-flow__controls');
    for (const name of ['Chat', '3D space']) {
      expect(rail && within(rail as HTMLElement).queryByRole('button', { name })).toBeFalsy();
    }
  });

  /**
   * The whole vertical slice for an object-scoped runtime: add the object, open it at full
   * size from its details panel, and get the board back. The button is not wired per kind
   * — it reads `creationObjectSurface`, which is why one control opens all three runtimes.
   */
  it('opens an object at full size from its details panel, and hands the board back', () => {
    render(<CreationCanvas sessionId="surface-page-open-test" persistence="local" />);
    const board = () => document.querySelector<HTMLElement>('[data-view]')!;

    // Adding selects, which is what opens the details panel the control lives in.
    fireEvent.click(screen.getByTestId('canvas-palette-resume'));
    const open = screen.getByTestId('open-page-surface');
    expect(open).toHaveAccessibleName('Open as a page');

    fireEvent.click(open);
    expect(board()).toHaveAttribute('data-view', 'page');
    const surface = screen.getByTestId('canvas-page-surface');
    // The medium is named beside the object, so the surface says what it is.
    expect(within(surface).getByText('Page')).toBeInTheDocument();

    fireEvent.click(within(surface).getByRole('button', { name: 'Back to the board' }));
    expect(board()).toHaveAttribute('data-view', 'graph');
    expect(screen.queryByTestId('canvas-page-surface')).not.toBeInTheDocument();
    // An object surface is never remembered — it cannot be restored without its object.
    expect(window.localStorage.getItem(CANVAS_SURFACE_STORAGE_KEY)).not.toBe('page');
  });

  /**
   * A card is the whole object for most kinds. Offering "open at full size" on a task
   * would promise a runtime that does not exist, so the control renders nothing.
   */
  it('offers no full-size surface for a kind whose card is the whole object', () => {
    render(<CreationCanvas sessionId="surface-no-open-test" persistence="local" />);
    fireEvent.click(screen.getByTestId('canvas-palette-task'));
    expect(screen.queryByTestId('open-page-surface')).not.toBeInTheDocument();
    expect(screen.queryByTestId('open-play-surface')).not.toBeInTheDocument();
    expect(screen.queryByTestId('open-site-surface')).not.toBeInTheDocument();
    expect(screen.queryByTestId('open-timeline-surface')).not.toBeInTheDocument();
  });

  /**
   * The site runtime end to end. Its own axis is the WIDTH — the one thing a 455px card
   * could never offer — so the surface is only worth having if that control is real and
   * if changing it does not quietly re-author the object the author designed at desktop.
   */
  it('opens a site at a width the reader picks, without re-authoring the object', () => {
    render(<CreationCanvas sessionId="surface-site-open-test" persistence="local" />);
    const board = () => document.querySelector<HTMLElement>('[data-view]')!;

    fireEvent.click(screen.getByTestId('canvas-palette-website'));
    const open = screen.getByTestId('open-site-surface');
    expect(open).toHaveAccessibleName('Open the site');

    fireEvent.click(open);
    expect(board()).toHaveAttribute('data-view', 'site');
    const surface = screen.getByTestId('canvas-site-surface');
    expect(within(surface).getByText('Site')).toBeInTheDocument();

    // The width starts at what the object IS, and the reader can move it.
    const stage = surface.querySelector<HTMLElement>('[data-viewport]')!;
    expect(stage).toHaveAttribute('data-viewport', 'desktop');
    fireEvent.click(within(surface).getByRole('button', { name: 'Phone' }));
    expect(surface.querySelector('[data-viewport]')).toHaveAttribute('data-viewport', 'mobile');

    // Looking is not authoring: the object's own viewport is untouched, so the board
    // preview and any export still draw the site the author designed.
    fireEvent.click(within(surface).getByRole('button', { name: 'Back to the board' }));
    expect(board()).toHaveAttribute('data-view', 'graph');
    fireEvent.click(screen.getByTestId('open-site-surface'));
    expect(screen.getByTestId('canvas-site-surface').querySelector('[data-viewport]'))
      .toHaveAttribute('data-viewport', 'desktop');
  });

  /**
   * One decision, one control. Pressing the lit surface returns to the board, which is
   * what preserves the toggle behaviour the 3D command has always had without the
   * registry needing to know that 3D is special.
   */
  it('lets exactly one surface be lit, and returns to the board when it is pressed again', () => {
    render(<CreationCanvas sessionId="surface-switcher-test" persistence="local" />);
    const lit = () => ['Chat', 'Board', '3D space']
      .filter((name) => surfaceButton(name).getAttribute('aria-pressed') === 'true');

    expect(lit()).toEqual(['Board']);
    fireEvent.click(surfaceButton('Chat'));
    expect(lit()).toEqual(['Chat']);
    fireEvent.click(surfaceButton('Chat'));
    expect(lit()).toEqual(['Board']);
  });
});
