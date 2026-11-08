import { useCallback, useMemo, useState } from 'react';
import type { CreationNodeData } from '../types';
import { useCreationNodeActions } from '../bodies/nodeActions';
import {
  addComicBranch, addComicBubble, addComicPage, moveComicPage, readComicState, removeComicBranch, removeComicBubble, removeComicPage,
  setComicLayout, updateComicBranch, updateComicBubble, updateComicPanel,
  type ComicBranch, type ComicBubble, type ComicBubbleKind, type ComicLayoutId, type ComicState,
} from '@/lib/creation/comic/comicState';

/**
 * The comic card's state: the pages stored on the object, and which page and panel are
 * selected. The pages persist through the object's own `edit` action
 * (`data.comicPages`, with the page size beside them); selection stays local so moving
 * around the comic never writes to the board. `editable` is false when the board gives
 * the card no `edit`.
 */
export function useComicEditor(data: CreationNodeData) {
  const { edit } = useCreationNodeActions();
  const { comicPages, comicWidth, comicHeight } = data;
  const state = useMemo(() => readComicState(comicPages, comicWidth, comicHeight), [comicPages, comicWidth, comicHeight]);
  const [pageSelection, setPageSelection] = useState<string | null>(null);
  const [panelSelection, setPanelSelection] = useState<string | null>(null);

  const page = state.pages.find((entry) => entry.id === pageSelection) ?? state.pages[0]!;
  const panel = page.panels.find((entry) => entry.id === panelSelection) ?? page.panels[0] ?? null;
  const editable = !!edit;

  const commit = useCallback((next: ComicState) => {
    edit?.({ comicPages: next.pages, comicWidth: next.width, comicHeight: next.height } as Partial<CreationNodeData>);
  }, [edit]);

  const actions = useMemo(() => ({
    addPage: (layout: ComicLayoutId) => { const result = addComicPage(state, layout, page.id); setPageSelection(result.pageId); setPanelSelection(null); commit(result.state); },
    removePage: () => { const result = removeComicPage(state, page.id); setPageSelection(result.selectedId); setPanelSelection(null); commit(result.state); },
    movePage: (delta: -1 | 1) => commit(moveComicPage(state, page.id, state.pages.indexOf(page) + delta)),
    setLayout: (layout: ComicLayoutId) => commit(setComicLayout(state, page.id, layout)),
    setImage: (imageUrl: string | null) => { if (panel) commit(updateComicPanel(state, page.id, panel.id, { imageUrl })); },
    addBubble: (kind: ComicBubbleKind) => { if (panel) commit(addComicBubble(state, page.id, panel.id, kind).state); },
    updateBubble: (bubbleId: string, patch: Partial<Omit<ComicBubble, 'id'>>) => { if (panel) commit(updateComicBubble(state, page.id, panel.id, bubbleId, patch)); },
    removeBubble: (bubbleId: string) => { if (panel) commit(removeComicBubble(state, page.id, panel.id, bubbleId)); },
    addBranch: () => commit(addComicBranch(state, page.id)),
    updateBranch: (branchId: string, patch: Partial<Omit<ComicBranch, 'id'>>) => commit(updateComicBranch(state, page.id, branchId, patch)),
    removeBranch: (branchId: string) => commit(removeComicBranch(state, page.id, branchId)),
  }), [state, page, panel, commit]);

  return {
    state, page, panel, editable, actions,
    selectPage: (id: string) => { setPageSelection(id); setPanelSelection(null); },
    selectPanel: setPanelSelection,
  };
}
