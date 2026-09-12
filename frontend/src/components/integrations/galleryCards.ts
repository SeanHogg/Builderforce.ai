/**
 * Integrations gallery cards — derived, never declared.
 *
 * One card per provider in the server's CONNECT catalog (every provider a key
 * can be stored for), plus any synced-board provider that connects without a
 * stored key (Rally). A card's category is the catalog's, so a web-search key
 * files under "search" and a warehouse under "data" — not under source control,
 * which is where every non-board provider used to land.
 */
import type { BoardProviderMeta } from '@/lib/builderforceApi';
import type { ConnectableCatalog } from '@/lib/connectableCatalog';

export interface GalleryCard {
  id: string;
  /** Brand name. */
  label: string;
  category: string;
  /** The adapter can drive the migration wizard. */
  supportsDiscovery: boolean;
  /** A key for it can be stored through the credentials manager. */
  connectable: boolean;
}

export function buildGalleryCards(catalog: ConnectableCatalog | null, boards: readonly BoardProviderMeta[]): GalleryCard[] {
  const boardById = new Map(boards.map((board) => [board.id, board]));
  const cards: GalleryCard[] = (catalog?.providers ?? []).map((provider) => ({
    id: provider.id,
    label: provider.label,
    category: provider.category,
    supportsDiscovery: boardById.get(provider.id)?.supportsDiscovery ?? false,
    connectable: true,
  }));
  const seen = new Set(cards.map((card) => card.id));
  for (const board of boards) {
    if (seen.has(board.id)) continue;
    cards.push({ id: board.id, label: board.label, category: board.category, supportsDiscovery: board.supportsDiscovery, connectable: false });
  }
  return cards;
}

/**
 * Cards grouped into sections, in the server's category order. A category the
 * order does not name still renders (after the named ones) rather than dropping
 * its cards.
 */
export function groupGalleryCards(
  cards: readonly GalleryCard[],
  categoryOrder: readonly string[],
  search: string,
): [string, GalleryCard[]][] {
  const query = search.trim().toLowerCase();
  const groups = new Map<string, GalleryCard[]>();
  for (const card of cards) {
    if (query && !`${card.label} ${card.id} ${card.category}`.toLowerCase().includes(query)) continue;
    const list = groups.get(card.category) ?? [];
    list.push(card);
    groups.set(card.category, list);
  }
  const order = [...categoryOrder, ...[...groups.keys()].filter((category) => !categoryOrder.includes(category))];
  return order.filter((category) => groups.has(category)).map((category) => [category, groups.get(category)!]);
}
