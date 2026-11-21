import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCollectionPreferences } from './collectionPreferences';

describe('useCollectionPreferences', () => {
  beforeEach(() => window.localStorage.clear());

  it('regression: List sticks on a card-default surface (stored table beats a card default)', () => {
    const { result } = renderHook(() => useCollectionPreferences('test.cardDefault', 'card'));
    expect(result.current.view).toBe('card');
    act(() => result.current.setView('table'));
    expect(result.current.view).toBe('table');
  });

  it('regression: Card sticks on a table-default surface', () => {
    const { result } = renderHook(() => useCollectionPreferences('test.tableDefault', 'table'));
    expect(result.current.view).toBe('table');
    act(() => result.current.setView('card'));
    expect(result.current.view).toBe('card');
  });

  it('regression: the legacy stored value "list" reads as table', () => {
    window.localStorage.setItem('collection.prefs.test.legacy', JSON.stringify({ view: 'list' }));
    const { result } = renderHook(() => useCollectionPreferences('test.legacy', 'card'));
    expect(result.current.view).toBe('table');
  });

  it('regression: nothing (or garbage) stored falls back to the surface default', () => {
    const unset = renderHook(() => useCollectionPreferences('test.unset', 'card'));
    expect(unset.result.current.view).toBe('card');
    window.localStorage.setItem('collection.prefs.test.garbage', JSON.stringify({ view: 'nonsense' }));
    const garbage = renderHook(() => useCollectionPreferences('test.garbage', 'card'));
    expect(garbage.result.current.view).toBe('card');
  });
});
