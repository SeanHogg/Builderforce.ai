/**
 * What the browser tools need from the browser — a PORT, so the tool catalog and its
 * tests never touch `chrome.*` (the Chrome adapter is `chromeTabPort.ts`).
 */
import type { ElementFacts, PageRequest, PageResponse } from '../page/pageProtocol';

export interface TabInfo {
  id: number;
  url: string;
  title: string;
  active: boolean;
}

export interface TabPort {
  /** Every tab in the current window. */
  listTabs(): Promise<TabInfo[]>;
  /** One tab, or null when it is gone. */
  getTab(tabId: number): Promise<TabInfo | null>;
  /** Make a tab the active one (and Rovr's working tab). */
  activate(tabId: number): Promise<void>;
  /** Load `url` in `tabId`, or in a new tab when `tabId` is null. Resolves once loaded. */
  navigate(tabId: number | null, url: string, timeoutMs: number): Promise<TabInfo>;
  /** Ask the page agent in `tabId` (injecting it first when needed). */
  send(tabId: number, request: PageRequest): Promise<PageResponse>;
  /** A PNG data URL of the visible part of `tabId`'s window. */
  screenshot(tabId: number): Promise<string>;
}

/**
 * The tab Rovr is working in — the active tab of its window unless a tool switched to
 * another. Read SYNCHRONOUSLY by the safety gate, so it is kept current by the host from
 * tab events rather than looked up per call.
 */
export interface WorkingTab {
  current(): { id: number; url: string } | null;
  set(tab: { id: number; url: string } | null): void;
  /** Told after every change — the panel's context chip follows the tab Rovr acts on. */
  subscribe(listener: () => void): () => void;
}

export function createWorkingTab(): WorkingTab {
  let tab: { id: number; url: string } | null = null;
  const listeners = new Set<() => void>();
  return {
    current: () => tab,
    set: (next) => {
      tab = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * What the page agent last MEASURED about each element ref, per tab — the facts the
 * synchronous safety gate classifies a click or a keystroke on. Cleared when a tab
 * navigates (its refs belong to a page that is gone).
 */
export interface ElementCache {
  record(tabId: number, elements: readonly ElementFacts[]): void;
  factsFor(tabId: number, ref: string): ElementFacts | undefined;
  clear(tabId: number): void;
}

export function createElementCache(): ElementCache {
  const byTab = new Map<number, Map<string, ElementFacts>>();
  return {
    record(tabId, elements) {
      let refs = byTab.get(tabId);
      if (!refs) {
        refs = new Map();
        byTab.set(tabId, refs);
      }
      for (const e of elements) refs.set(e.ref, e);
    },
    factsFor: (tabId, ref) => byTab.get(tabId)?.get(ref),
    clear: (tabId) => {
      byTab.delete(tabId);
    },
  };
}
