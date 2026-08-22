import { describe, it, expect } from 'vitest';
import { EMBED_VIEW_KEYS } from '@seanhogg/builderforce-embedded';
import en from '@/i18n/messages/en.json';
import { listComponents, listComponentsForMount, getComponentForMount } from '@/lib/components/registry';
import { mountsOf } from '@/lib/components/types';

/**
 * THE TWO LISTS THAT MUST NAME THE SAME SET.
 *
 * `EMBED_VIEWS` is the WIRE contract: a host builds its own nav from it, in a
 * package with no React in it, so it cannot hold the components themselves. The
 * registry holds the components. That is a legitimate split — and it is exactly
 * the shape that rots, because nothing in the type system connects a key in one
 * to a declaration in the other.
 *
 * It already rotted once: every `EMBED_VIEWS` entry claimed `available: true`
 * while the route's switch had branches for fourteen of them, so `feature-roi`
 * served a blank frame to anyone who framed it. This is the guard that makes that
 * a red test instead of a support ticket.
 */
describe('app-mountable components ↔ EMBED_VIEWS', () => {
  it('every embed view resolves to a component that opted into the app mount', () => {
    const missing = EMBED_VIEW_KEYS.filter((key) => !getComponentForMount(key, 'app'));
    expect(missing, `EMBED_VIEWS declares these views, and no component claims them: ${missing.join(', ')}`).toEqual([]);
  });

  it('every app-mountable component is declared to hosts', () => {
    const keys = new Set<string>(EMBED_VIEW_KEYS);
    const undeclared = listComponentsForMount('app').map((c) => c.id).filter((id) => !keys.has(id));
    expect(undeclared, `these components are reachable at /embed/<id> but no host can discover them: ${undeclared.join(', ')}`).toEqual([]);
  });
});

describe('the component registry', () => {
  it('has no duplicate ids', () => {
    const seen = new Map<string, number>();
    for (const c of listComponents()) seen.set(c.id, (seen.get(c.id) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    // A duplicate id is not cosmetic: `getComponent` resolves the LAST one, so a
    // pin, a board card and an embed would silently render a different component
    // from the one their author picked.
    expect(dupes, `duplicate component ids: ${dupes.join(', ')}`).toEqual([]);
  });

  it('declares at least one mount for every component', () => {
    const stranded = listComponents().filter((c) => mountsOf(c).length === 0).map((c) => c.id);
    expect(stranded, `these components can never render anywhere: ${stranded.join(', ')}`).toEqual([]);
  });

  it('names a title and group that exist in the catalog', () => {
    // `check:i18n-keys` reads literal `t('…')` calls out of source and cannot see
    // these: every mount renders `t('title.' + def.titleKey)`, so the key is only
    // knowable from the registry. Without this the picker renders raw dotted
    // paths where labels belong — the exact failure that guard was written for.
    const catalog = en.components as unknown as {
      title: Record<string, unknown>;
      group: Record<string, unknown>;
    };
    const resolve = (bag: Record<string, unknown>, key: string): unknown =>
      key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), bag);

    const missingTitle = listComponents().filter((c) => typeof resolve(catalog.title, c.titleKey) !== 'string').map((c) => c.id);
    expect(missingTitle, `components.title is missing: ${missingTitle.join(', ')}`).toEqual([]);

    const missingGroup = [...new Set(listComponents().map((c) => c.group))].filter((g) => typeof resolve(catalog.group, g) !== 'string');
    expect(missingGroup, `components.group is missing: ${missingGroup.join(', ')}`).toEqual([]);
  });

  it('keeps the dashboard tiles off the full-surface mounts', () => {
    // The 129 components that predate portability default to `['dashboard']`, and
    // that default is load-bearing: a stat tile rendered as somebody's whole
    // published page is not a product. A tile reaches another mount by DECLARING
    // it, never by inheriting it.
    const tiles = listComponents().filter((c) => c.mounts === undefined);
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) expect(mountsOf(tile)).toEqual(['dashboard']);
  });
});
