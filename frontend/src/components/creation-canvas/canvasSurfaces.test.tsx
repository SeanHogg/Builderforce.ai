import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

// The copy IS the assertion here — a surface switcher whose entries are named
// "creationCanvas.surface.chat.label" tells nobody which surface they are on. One shared
// resolver, so this file cannot quietly drift from the one the app uses.
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

import {
  CANVAS_SURFACES,
  CANVAS_SURFACE_STORAGE_KEY,
  canvasSurfaceDefinition,
  DEFAULT_CANVAS_SURFACE,
  readCanvasSurface,
  sanitizeCanvasSurface,
  writeCanvasSurface,
} from '@/lib/canvasSurfaces';
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

  it('degrades an unknown surface to the board rather than to a blank centre', () => {
    expect(sanitizeCanvasSurface('timeline')).toBe(DEFAULT_CANVAS_SURFACE);
    expect(sanitizeCanvasSurface(null)).toBe(DEFAULT_CANVAS_SURFACE);
    expect(canvasSurfaceDefinition('nope' as 'graph').id).toBe(DEFAULT_CANVAS_SURFACE);
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

    fireEvent.click(screen.getAllByRole('button', { name: 'Chat' })[0]!);

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
    expect(screen.getByRole('button', { name: 'Show the chat in the Brain object' })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Chat' })[0]!);
    expect(screen.queryByRole('button', { name: 'Show the chat in the Brain object' })).not.toBeInTheDocument();
  });

  it('hands the board back from inside the conversation, and remembers the choice', () => {
    render(<CreationCanvas sessionId="surface-chat-return-test" persistence="local" />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Chat' })[0]!);
    expect(window.localStorage.getItem(CANVAS_SURFACE_STORAGE_KEY)).toBe('chat');

    const surface = screen.getByTestId('canvas-chat-surface');
    fireEvent.click(within(surface).getByRole('button', { name: /Open the board/ }));

    expect(document.querySelector('[data-view]')).toHaveAttribute('data-view', 'graph');
    expect(screen.queryByTestId('canvas-chat-surface')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(CANVAS_SURFACE_STORAGE_KEY)).toBe('graph');
  });

  /**
   * One decision, one control. Pressing the lit surface returns to the board, which is
   * what preserves the toggle behaviour the 3D command has always had without the
   * registry needing to know that 3D is special.
   */
  it('lets exactly one surface be lit, and returns to the board when it is pressed again', () => {
    render(<CreationCanvas sessionId="surface-switcher-test" persistence="local" />);
    const lit = () => ['Chat', 'Board', '3D space']
      .filter((name) => screen.getAllByRole('button', { name }).some((button) => button.getAttribute('aria-pressed') === 'true'));

    expect(lit()).toEqual(['Board']);
    fireEvent.click(screen.getAllByRole('button', { name: 'Chat' })[0]!);
    expect(lit()).toEqual(['Chat']);
    fireEvent.click(screen.getAllByRole('button', { name: 'Chat' })[0]!);
    expect(lit()).toEqual(['Board']);
  });
});
