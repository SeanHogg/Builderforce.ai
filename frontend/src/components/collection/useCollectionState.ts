import type { CollectionDescriptor } from './descriptor';
import { useCollectionPreferences, type CollectionPreferences } from './collectionPreferences';
import { useCollectionPaging, type CollectionPaging } from './useCollectionPaging';
import { useCollectionSort, type CollectionSort } from './useCollectionSort';

/**
 * useCollectionState — the ONE wiring of a Collection's chrome state (PRD 47
 * §3.1): the surface's stored preferences seed the page size, and a sort change
 * resets paging to page 1. `<Collection>` calls it for its own fallback state;
 * a page whose source depends on sort/page calls it (directly, or through
 * `useLocalCollection`) and passes `sort` + `paging` into `<Collection>`.
 */
export interface CollectionState {
  prefs: CollectionPreferences;
  paging: CollectionPaging;
  sort: CollectionSort;
}

export function useCollectionState<Row>(descriptor: CollectionDescriptor<Row>): CollectionState {
  const prefs = useCollectionPreferences(descriptor.surfaceKey, descriptor.defaultView ?? 'table');
  const paging = useCollectionPaging(prefs.pageSize);
  const sort = useCollectionSort(descriptor, paging.reset);
  return { prefs, paging, sort };
}
