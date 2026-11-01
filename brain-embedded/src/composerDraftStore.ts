'use client';

import { useState, useSyncExternalStore, type SetStateAction } from 'react';

/**
 * The composer's text as an EXTERNAL store: a keystroke writes here and only the components
 * that subscribe to the text re-render, not the surface that owns the composer.
 *
 * A `useState` for the box at the top of a chat surface re-renders every hook, the rail, the
 * notices and the whole composer tree on each key. Here the surface holds one stable store
 * (its identity never changes), the textarea subscribes to the text, and everything else
 * subscribes to the narrow fact it needs ({@link useDraftSelector}: "is the box empty?",
 * "who does the leading @mention name?") so it re-renders only when THAT changes.
 *
 * `get()` is the text as the SEND PATH sees it: a write changes it synchronously, before any
 * subscriber has re-rendered - the guarantee `useComposerDraft` gives its `draft()` read.
 * `set` accepts a value or an updater, applied against what the box holds when the write lands
 * (`restoreTurn` gives a turn back that way, so a concurrent clear or keystroke is respected).
 */
export interface ComposerDraftStore {
  /** The text right now. */
  get(): string;
  /** Write it (clear, seed), or `set(cur => next)` against what the box holds now. */
  set(next: SetStateAction<string>): void;
  /** Be told after every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** One draft store. Hosts hold it with {@link useComposerDraftStore} so it is made once per mount. */
export function createComposerDraftStore(initial = ''): ComposerDraftStore {
  let text = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => text,
    set(next) {
      const value = typeof next === 'function' ? next(text) : next;
      if (value === text) return;
      text = value;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** The mount's ONE draft store: its identity never changes, so handing it down never re-renders a child. */
export function useComposerDraftStore(initial = ''): ComposerDraftStore {
  return useState(() => createComposerDraftStore(initial))[0];
}

/**
 * A value derived from the text, re-rendering the caller only when the DERIVED value changes.
 * `select` must return a primitive or an object that is stable for equal answers (a member of a
 * list it was given, never a fresh literal) - the store is read on every render to check it.
 */
export function useDraftSelector<T>(store: ComposerDraftStore, select: (text: string) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()), () => select(store.get()));
}

/** The text itself: for the one component that draws it (the textarea). */
export function useDraftText(store: ComposerDraftStore): string {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

const isBlank = (text: string): boolean => text.trim().length === 0;

/** Whether the box holds nothing but whitespace - what Send, the suggestions and the active frame depend on. */
export function useDraftIsEmpty(store: ComposerDraftStore): boolean {
  return useDraftSelector(store, isBlank);
}
