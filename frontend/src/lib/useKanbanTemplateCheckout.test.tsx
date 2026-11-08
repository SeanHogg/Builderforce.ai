/**
 * @vitest-environment jsdom
 *
 * The pending checkout is keyed by CONSUMER: three surfaces use this hook, and a shared key
 * resumed the checkout on whichever of them mounted first rather than the one that started it.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkout: vi.fn(),
  completeCheckout: vi.fn(),
  t: (key: string) => key,
}));

vi.mock('next-intl', () => ({ useTranslations: () => mocks.t }));
vi.mock('./creationListings', () => ({
  creationListingApi: { checkout: mocks.checkout, completeCheckout: mocks.completeCheckout },
}));

import { PurchaseRequiredError } from './planLimitError';
import { useKanbanTemplateCheckout } from './useKanbanTemplateCheckout';

const KEY = (consumer: string) => `bf.kanbanTemplateCheckout:${consumer}`;

beforeEach(() => {
  mocks.checkout.mockReset();
  mocks.completeCheckout.mockReset();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('useKanbanTemplateCheckout', () => {
  it('resolves null for an error that is not a template purchase', async () => {
    const { result } = renderHook(() => useKanbanTemplateCheckout('roster-card'));
    expect(await result.current(new Error('boom'), 't1')).toBeNull();
    expect(mocks.checkout).not.toHaveBeenCalled();
  });

  it('starts the checkout and records the pending template under ITS consumer key only', async () => {
    mocks.checkout.mockResolvedValue('about:blank#checkout');
    const { result } = renderHook(() => useKanbanTemplateCheckout('roster-card'));
    const error = new PurchaseRequiredError({ error: 'pay', listingSlug: 'tpl', listingName: 'Tpl' });
    expect(await result.current(error, 't1')).toBe('redirecting');
    expect(window.sessionStorage.getItem(KEY('roster-card'))).toBe('t1');
    expect(window.sessionStorage.getItem(KEY('templates-page'))).toBeNull();
  });

  it('answers the localized failure when the checkout cannot start', async () => {
    mocks.checkout.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useKanbanTemplateCheckout('roster-card'));
    const error = new PurchaseRequiredError({ error: 'pay', listingSlug: 'tpl' });
    expect(await result.current(error, 't1')).toBe('checkoutFailed');
    expect(window.sessionStorage.getItem(KEY('roster-card'))).toBeNull();
  });

  it('on return, only the consumer that started the checkout gets onGranted', async () => {
    window.sessionStorage.setItem(KEY('roster-card'), 't1');
    window.history.replaceState(null, '', '/?checkout=sess_1');
    mocks.completeCheckout.mockResolvedValue(undefined);
    const other = vi.fn();
    const owner = vi.fn();
    renderHook(() => useKanbanTemplateCheckout('templates-page', { onGranted: other }));
    expect(mocks.completeCheckout).not.toHaveBeenCalled();
    renderHook(() => useKanbanTemplateCheckout('roster-card', { onGranted: owner }));
    await waitFor(() => expect(owner).toHaveBeenCalledWith('t1'));
    expect(other).not.toHaveBeenCalled();
    expect(mocks.completeCheckout).toHaveBeenCalledWith('sess_1');
    expect(window.sessionStorage.getItem(KEY('roster-card'))).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('reports onFailed when completing the checkout fails', async () => {
    window.sessionStorage.setItem(KEY('roster-card'), 't1');
    window.history.replaceState(null, '', '/?checkout=sess_2');
    mocks.completeCheckout.mockRejectedValue(new Error('nope'));
    const onFailed = vi.fn();
    renderHook(() => useKanbanTemplateCheckout('roster-card', { onFailed }));
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith('completeFailed'));
  });

  it('a cancelled return clears the pending entry without completing', () => {
    window.sessionStorage.setItem(KEY('roster-card'), 't1');
    window.history.replaceState(null, '', '/?checkout=cancelled');
    renderHook(() => useKanbanTemplateCheckout('roster-card'));
    expect(window.sessionStorage.getItem(KEY('roster-card'))).toBeNull();
    expect(mocks.completeCheckout).not.toHaveBeenCalled();
  });
});
