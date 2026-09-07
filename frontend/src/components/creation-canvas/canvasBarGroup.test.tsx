import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

// The copy IS the assertion here, the same as it is for the session actions beside it: a
// caption reading "creationCanvas.barGroup.board" names nothing. One shared resolver, so
// this file cannot drift from the catalog the app ships.
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

import { CANVAS_BAR_GROUP_ORDER, canvasBarGroup, canvasBarGroupIds } from '@/lib/canvasBarGroups';
import { canvasSessionClusters } from '@/lib/canvasSessionActions';
import { STAGES } from '@/lib/navGroups';
import de from '@/i18n/messages/de.json';
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import zh from '@/i18n/messages/zh.json';
import { CreationCanvas } from './CreationCanvas';

/**
 * THE BAR IS THE ARC.
 *
 * The command bar used to caption its troughs `Workflow · History · Tools · Live · Share ·
 * View · Add · People` — eight names, every one of them describing how the controls are
 * implemented rather than what a person is doing, and two of them (`Tools`, `Live`) plain
 * shelves. It now draws the five stages the rest of the product already teaches, in order,
 * plus one group for what acts on the board rather than on the work.
 *
 * These assert the properties that make that a system rather than a re-skin: the groups
 * ARE the arc and in its order, a stage group takes the RAIL's word for its stage rather
 * than a second translation of it, every group is named in every language, and the caption
 * never becomes a second voice reading the group's name back to assistive tech.
 */

const CATALOGS = { en, zh, es, fr, de } as unknown as Record<string, {
  creationCanvas: Record<string, unknown>;
  nav: Record<string, unknown>;
}>;

const read = (root: unknown, key: string) =>
  key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown> | undefined)?.[part], root);

describe('the canvas bar group registry', () => {
  /** The groups are the arc, in the arc's order, and nothing else. */
  it('draws the five stages in order, plus the one group that names no stage', () => {
    expect(CANVAS_BAR_GROUP_ORDER).toEqual(['idea', 'make', 'run', 'measure', 'reach', 'board']);
    // Each stage group names a REAL stage — not a word that merely looks like one.
    for (const id of CANVAS_BAR_GROUP_ORDER) {
      const stage = canvasBarGroup(id).stage;
      if (stage) expect(STAGES, `${id} names a stage the arc does not have`).toContain(stage);
    }
  });

  /**
   * A stage group must NOT own its caption copy. It names a `Stage`, and the caption is
   * `nav.stage.<id>` — the same five strings the left rail draws over the same-coloured
   * dot. A second set of words for the same five ideas is how a vocabulary drifts, and
   * this registry is where that would have started.
   */
  it('takes a stage caption from the rail rather than translating it twice', () => {
    for (const id of CANVAS_BAR_GROUP_ORDER) {
      const def = canvasBarGroup(id);
      if (!def.stage) continue;
      expect(def.captionKey, `${id} declares both a stage and its own caption`).toBeUndefined();
      for (const [locale, catalog] of Object.entries(CATALOGS)) {
        expect(typeof read(catalog.nav, `stage.${def.stage}`), `${locale}:nav.stage.${def.stage}`).toBe('string');
      }
    }
  });

  /** A caption and an accessible name are copy, in five catalogs, or they are keys drawn
   *  on the bar. */
  it('names every group in every language it ships', () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const id of canvasBarGroupIds()) {
        const def = canvasBarGroup(id);
        expect(typeof read(catalog.creationCanvas, def.labelKey), `${locale}:${def.labelKey}`).toBe('string');
        if (!def.captionKey) continue;
        const caption = read(catalog.creationCanvas, def.captionKey) as string;
        expect(typeof caption, `${locale}:${def.captionKey}`).toBe('string');
        // It sits over a 60-200px trough. A sentence there is a second toolbar made of
        // text, and the bar is already the widest thing on the canvas.
        expect(caption.length, `${locale}:${def.captionKey}`).toBeLessThanOrEqual(16);
      }
    }
  });

  /**
   * The trough's contents come from `canvasSessionClusters`; its caption comes from this
   * registry. The two are closed over each other by the TYPE now — a group id IS a cluster
   * — but a cluster the bar never draws would still be an action nobody can reach, so the
   * order list has to cover every cluster the registry can produce.
   */
  it('draws every session-action cluster the registry can produce', () => {
    for (const { cluster } of canvasSessionClusters()) {
      expect(CANVAS_BAR_GROUP_ORDER, `${cluster} is filed under no group the bar draws`).toContain(cluster);
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
  it('captions each group with its stage without naming the group twice', () => {
    render(<CreationCanvas sessionId="bar-group-caption-test" persistence="local" />);

    const make = screen.getByRole('group', { name: 'Make — shape what is on the board' });
    // The RAIL's word, not a canvas copy of it.
    expect(within(make).getByText('Make')).toHaveAttribute('aria-hidden', 'true');
    expect(within(make).getByRole('button', { name: 'Undo canvas change' })).toBeInTheDocument();
    // The composer's own bubble LEADS Make. It used to be last in a run of nine `View`
    // glyphs, which said it was chrome; it is the main input to the canvas.
    expect(within(make).getAllByRole('button')[0]).toBe(within(make).getByTestId('canvas-prompt-toggle'));
  });

  /** Putting something down is the whole of "what if?", so the palette's door leads Idea. */
  it('leads Idea with the one door onto the palette', () => {
    render(<CreationCanvas sessionId="bar-group-idea-test" persistence="local" />);

    const idea = screen.getByRole('group', { name: 'Idea — put something on the board' });
    expect(within(idea).getByText('Idea')).toBeInTheDocument();
    expect(within(idea).getAllByRole('button')[0]).toBe(within(idea).getByTestId('canvas-quick-add'));
  });

  /**
   * Who is here, who works here, how to invite somebody and where the work GOES are one
   * named set: Reach is "get it in front of people", and every one of those is that.
   */
  it('gathers the people and the doors out into Reach', () => {
    render(<CreationCanvas sessionId="bar-group-reach-test" persistence="local" />);

    const reach = screen.getByRole('group', { name: 'Reach — share it, and take it out of here' });
    expect(within(reach).getByLabelText('Active collaborators')).toBeInTheDocument();
    expect(within(reach).getByRole('button', { name: 'Invite collaborators' })).toBeInTheDocument();
    // ONE worded button, closing the group. Publish is a row underneath it, not a second
    // word beside it — see `canvasSessionActions.ts` for why that pairing was a fork.
    expect(within(reach).getByTestId('canvas-make-it-real')).toBeInTheDocument();
    expect(within(reach).queryByRole('button', { name: 'Publish' })).toBeNull();
  });

  /**
   * The one group with no stage, and the reason it has none: everything in it is done to
   * the BOARD rather than to the work. Giving it a stage caption is exactly how the old
   * `Tools` shelf formed.
   */
  it('captions the board group with its own word, not a stage', () => {
    render(<CreationCanvas sessionId="bar-group-board-test" persistence="local" />);

    expect(canvasBarGroup('board').stage).toBeUndefined();
    const board = screen.getByRole('group', { name: 'This board' });
    expect(within(board).getByText('Board')).toBeInTheDocument();
    expect(within(board).getByRole('button', { name: 'More session actions' })).toBeInTheDocument();
    // A collapse with no way back is a one-way door, so the fold is here whatever else is.
    expect(within(board).getByTestId('canvas-bar-collapse')).toBeInTheDocument();
  });

  /**
   * THE VIEW COMMANDS ARE NOT ON THE BAR.
   *
   * They move the viewport; they do not advance the work, so no stage can honestly
   * caption them — and inventing a sixth caption for them is what this regroup undid.
   * They are a section of the ••• sheet, and NOT a second floating pill in the corner:
   * two toolbars over one canvas is what the left-hand rail was deleted for.
   */
  it('keeps zoom off the bar and inside the board menu', () => {
    render(<CreationCanvas sessionId="bar-group-view-test" persistence="local" />);

    const bar = screen.getByTestId('canvas-command-bar');
    expect(within(bar).queryByRole('button', { name: 'Zoom in' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Canvas view controls' })).toBeNull();
  });
});
