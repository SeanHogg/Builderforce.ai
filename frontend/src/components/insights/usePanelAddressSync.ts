/**
 * Two-way sync between the Insights panel stack and its address
 * (`?panel=<kind>:<id>[:<tab>]`, `&t=`, `&follow=1` — PRD 33 §4.1).
 *
 *   address → stack: on mount AND on every later navigation — a `router.push` /
 *     `router.replace` (Next's `useSearchParams` changes) or Back/Forward
 *     (`popstate`) — the addressed level opens, replaces the top when it names
 *     the same target, or the panel closes when the address names none;
 *   stack → address: whenever the top level changes, the address follows it with
 *     `history.replaceState`, keeping every other parameter (site, filter).
 *
 * Loop-free by ONE shared marker, `synced`: the canonical address key both sides
 * last agreed on. A side acts only on a key different from it and records the key
 * before acting, so the echo of its own write (the URL change after a
 * `replaceState`, the re-render after a stack change) is recognised and ignored.
 * The address is always read from `window.location` — the hook's inputs are only
 * the triggers — so it never depends on which router produced the change.
 */

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { InsightPanelLevel } from './panelKinds';
import { parsePanelParams, withPanelParams } from './panelUrl';
import type { PanelStackApi } from './usePanel';

/** The canonical address of a level ('' = no panel), shared by both directions. */
export function panelAddressKey(level: InsightPanelLevel | null): string {
  return level ? withPanelParams(new URLSearchParams(), level).toString() : '';
}

/** The registered level an address names, or null (no panel, or an unknown kind). */
export function levelFromAddress(search: string, knownKinds: ReadonlySet<string>): InsightPanelLevel | null {
  const parsed = parsePanelParams(search);
  if (!parsed || !knownKinds.has(parsed.kind)) return null;
  return {
    kind: parsed.kind as InsightPanelLevel['kind'],
    id: parsed.id,
    ...(parsed.tab ? { tab: parsed.tab } : {}),
    ...(parsed.t != null ? { t: parsed.t } : {}),
    ...(parsed.follow ? { follow: true } : {}),
  };
}

export function usePanelAddressSync(
  stack: Pick<PanelStackApi, 'levels' | 'push' | 'replace' | 'close'>,
  knownKinds: ReadonlySet<string>,
): void {
  const { levels, push, replace, close } = stack;
  const top = levels.length > 0 ? levels[levels.length - 1]! : null;
  const topKey = panelAddressKey(top);

  /** The address key both sides last agreed on; null until the first read. */
  const synced = useRef<string | null>(null);
  const levelsRef = useRef(levels);
  levelsRef.current = levels;
  /** The top key the stack → address effect last saw (skips its mount run). */
  const seenTopKey = useRef(topKey);

  // Triggers for "the address may have changed": Next's client navigation and Back/Forward.
  const searchKey = useSearchParams()?.toString() ?? '';
  const [popCount, setPopCount] = useState(0);
  useEffect(() => {
    const onPop = () => setPopCount((n) => n + 1);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // address → stack
  useEffect(() => {
    const level = levelFromAddress(window.location.search, knownKinds);
    const key = panelAddressKey(level);
    if (key === synced.current) return;
    synced.current = key;
    const current = levelsRef.current;
    const currentTop = current.length > 0 ? current[current.length - 1]! : null;
    if (key === panelAddressKey(currentTop)) return;
    if (!level) {
      if (current.length > 0) close();
      return;
    }
    if (currentTop && currentTop.kind === level.kind && currentTop.id === level.id) {
      replace([...current.slice(0, -1), level]);
    } else if (current.length === 0) {
      replace([level]);
    } else {
      push(level);
    }
  }, [searchKey, popCount, knownKinds, push, replace, close]);

  // stack → address
  useEffect(() => {
    if (topKey === seenTopKey.current) return;
    seenTopKey.current = topKey;
    if (topKey === synced.current) return;
    synced.current = topKey;
    const next = withPanelParams(new URLSearchParams(window.location.search), top);
    const query = next.toString();
    const href = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    if (href !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, '', href);
    }
  }, [topKey, top]);
}
