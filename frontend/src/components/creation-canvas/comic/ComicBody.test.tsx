import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ComicBody } from '../bodies/ComicBody';
import { CreationNodeActionsContext } from '../bodies/nodeActions';
import { ComicReader } from './ComicReader';
import { addComicBranch, addComicPage, createBlankComicState, updateComicBranch } from '@/lib/creation/comic/comicState';
import type { CreationNodeData } from '../types';

const data = { kind: 'comic', title: 'Strip' } as CreationNodeData;

describe('ComicBody', () => {
  it('writes the pages back through the object edit action', () => {
    const edit = vi.fn();
    render(<CreationNodeActionsContext.Provider value={{ edit }}><ComicBody id="c1" data={data} /></CreationNodeActionsContext.Provider>);
    fireEvent.click(screen.getByLabelText('canvas.kinds.comic.addPage'));
    expect(edit).toHaveBeenCalledTimes(1);
    const patch = edit.mock.calls[0]![0] as { comicPages: unknown[]; comicWidth: number; comicHeight: number };
    expect(patch.comicPages).toHaveLength(2);
    expect(patch.comicWidth).toBeGreaterThan(0);
  });

  it('offers no editing controls when the board gives the card no edit action', () => {
    render(<ComicBody id="c1" data={data} />);
    expect(screen.queryByLabelText('canvas.kinds.comic.addPage')).toBeNull();
    expect(screen.getByRole('region', { name: 'canvas.kinds.comic.readerLabel' })).toBeTruthy();
  });
});

describe('ComicReader', () => {
  function branching() {
    const first = createBlankComicState();
    const a = first.pages[0]!.id;
    const second = addComicPage(first);
    const third = addComicPage(second.state);
    let state = addComicBranch(third.state, a);
    state = updateComicBranch(state, a, state.pages[0]!.branches[0]!.id, { label: 'Take the deal', targetPageId: third.pageId, flagsToSet: ['deal'] });
    return state;
  }

  it('follows a chosen branch, collects its flag, and goes back', () => {
    render(<ComicReader state={branching()} />);
    expect(screen.getAllByText('canvas.kinds.comic.pageOf 1 3').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Take the deal'));
    expect(screen.getAllByText('canvas.kinds.comic.pageOf 3 3').length).toBeGreaterThan(0);
    expect(screen.getByText(/pathFlags deal/)).toBeTruthy();
    fireEvent.click(screen.getByText('canvas.kinds.comic.back'));
    expect(screen.getAllByText('canvas.kinds.comic.pageOf 1 3').length).toBeGreaterThan(0);
    expect(screen.queryByText(/pathFlags/)).toBeNull();
  });

  it('moves linearly when a page has no choices, and offers a restart at the end', () => {
    const base = addComicPage(createBlankComicState()).state;
    render(<ComicReader state={base} />);
    fireEvent.click(screen.getByText('canvas.kinds.comic.next'));
    expect(screen.getAllByText('canvas.kinds.comic.pageOf 2 2').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('canvas.kinds.comic.startOver'));
    expect(screen.getAllByText('canvas.kinds.comic.pageOf 1 2').length).toBeGreaterThan(0);
  });
});
