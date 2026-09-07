import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

// The copy IS the assertion here, the same as it is for the session actions beside it: a
// caption reading "creationCanvas.barGroup.history" names nothing. One shared resolver, so
// this file cannot drift from the catalog the app ships.
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

import { canvasBarGroup, canvasBarGroupIds } from '@/lib/canvasBarGroups';
import { canvasSessionClusters } from '@/lib/canvasSessionActions';
import de from '@/i18n/messages/de.json';
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import zh from '@/i18n/messages/zh.json';
import { CreationCanvas } from './CreationCanvas';

/**
 * THE BAR SAYS WHAT ITS GROUPS ARE FOR.
 *
 * The command bar had grouping and no labelling: undo/redo in one trough, three inspect
 * commands in another, the view commands in a bare row, and the only thing saying what any
 * of them were for was an `aria-label` a sighted reader never sees plus a tooltip you have
 * to hover one icon at a time to collect. These assert the two properties that make the
 * captions a system rather than a decoration — every group is NAMED from one table, in
 * every language, and the caption never becomes a second voice reading the group's name
 * back to assistive tech.
 */

const CATALOGS = { en, zh, es, fr, de } as unknown as Record<string, { creationCanvas: Record<string, unknown> }>;

describe('the canvas bar group registry', () => {
  /** A caption is copy, in five catalogs, or it is a key drawn on the bar. */
  it('names every group in every language it ships', () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      const canvas = catalog.creationCanvas;
      const read = (key: string) => key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown> | undefined)?.[part], canvas as unknown);
      for (const id of canvasBarGroupIds()) {
        const def = canvasBarGroup(id);
        expect(typeof read(def.labelKey), `${locale}:${def.labelKey}`).toBe('string');
        if (!def.captionKey) continue;
        const caption = read(def.captionKey) as string;
        expect(typeof caption, `${locale}:${def.captionKey}`).toBe('string');
        // It sits over a 60-200px trough. A sentence there is a second toolbar made of
        // text, and the bar is already the widest thing on the canvas.
        expect(caption.length, `${locale}:${def.captionKey}`).toBeLessThanOrEqual(16);
      }
    }
  });

  /**
   * The trough is drawn from `canvasSessionClusters`; the caption is drawn from this
   * registry. A cluster added to the actions registry with no entry here would draw an
   * anonymous huddle of glyphs — which is the exact state this replaced — so the two
   * lists have to stay closed over each other.
   */
  it('names every session-action cluster the bar can draw', () => {
    for (const { cluster } of canvasSessionClusters()) {
      expect(canvasBarGroup(cluster)).toBeTruthy();
    }
  });
});

describe('the captioned groups on the bar', () => {
  /**
   * The caption is for the EYE. The group is already named by `aria-label`, so exposing
   * the word as text too would have a screen reader read it twice — once as the group's
   * name, once as stray text inside it.
   */
  it('draws a caption above each group without naming the group twice', () => {
    render(<CreationCanvas sessionId="bar-group-caption-test" persistence="local" />);

    const history = screen.getByRole('group', { name: 'Canvas history' });
    expect(within(history).getByText('History')).toHaveAttribute('aria-hidden', 'true');
    expect(within(history).getByRole('button', { name: 'Undo canvas change' })).toBeInTheDocument();

    // The view commands were the bare row — grouped by proximity alone, and by nothing at
    // all once the prompt toggle sat down beside them.
    const view = screen.getByRole('group', { name: 'Canvas view controls' });
    expect(within(view).getByText('View')).toBeInTheDocument();
    expect(within(view).getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    // Showing and hiding the composer is a piece of this canvas's chrome, like the mini
    // map — it belongs IN the group rather than loose beside it, and it goes FIRST: the
    // prompt is the thing somebody is most likely to want back, and it was previously
    // the last glyph in a run of nine.
    expect(within(view).getAllByRole('button')[0]).toBe(within(view).getByTestId('canvas-prompt-toggle'));
  });

  /** Who is here, who works here and how to invite somebody read as ONE named set now,
   *  rather than three neighbours that happened to be adjacent. */
  it('gathers the people on this canvas into one named group', () => {
    render(<CreationCanvas sessionId="bar-group-people-test" persistence="local" />);

    const people = screen.getByRole('group', { name: 'People on this canvas' });
    expect(within(people).getByLabelText('Active collaborators')).toBeInTheDocument();
    expect(within(people).getByRole('button', { name: 'Invite collaborators' })).toBeInTheDocument();
  });

  /**
   * A group whose controls are already worded has nothing to add on screen — a "Publish"
   * caption over a button that says Publish is chrome explaining itself — but it is still
   * NAMED, which the doors-out row never was.
   */
  it('names the doors-out row without captioning what already carries a word', () => {
    render(<CreationCanvas sessionId="bar-group-handoff-test" persistence="local" />);

    const handoff = screen.getByRole('group', { name: 'Publish and more actions' });
    expect(within(handoff).getByRole('button', { name: 'More session actions' })).toBeInTheDocument();
    expect(within(handoff).queryByText('Publish and more actions')).toBeNull();
  });
});
