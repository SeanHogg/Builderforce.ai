import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { prescription } from '@/test/replayPrescriptionFixtures';
import { PrescriptionActions } from './PrescriptionActions';
import { offeredLinkActions } from './prescriptionActionUi';

/**
 * "Build the preview" (PRD 33 §5.1.4): the API sets `buildPreview` while a hosted
 * site's Fix it is applied with no preview release yet. The card links into that
 * project's workspace with the Publish panel open and the fix named — registry
 * data keyed on the DTO, never re-derived in the UI.
 */

vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/RoleGate', () => ({
  RoleGate: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const applied = (over = {}) => prescription({ id: 'rx-9', status: 'applied', actionKind: 'fix', next: [], buildPreview: { projectId: 42 }, ...over });

describe('Build the preview', () => {
  it('links an applied Fix it to its project workspace, Publish panel open, the fix named', () => {
    render(<PrescriptionActions siteId="site-1" prescription={applied()} onChanged={() => undefined} />);
    const link = screen.getByRole('link', { name: /replay\.prescription\.actions\.build-preview/ });
    const href = new URL(link.getAttribute('href')!, 'https://app.test');
    expect(href.pathname).toBe('/studio/project/42');
    expect(href.searchParams.get('panel')).toBe('publish');
    expect(href.searchParams.get('prescription')).toBe('rx-9');
  });

  it('is offered exactly when the API sets buildPreview', () => {
    expect(offeredLinkActions(applied()).map(({ row }) => row.id)).toEqual(['build-preview']);
    expect(offeredLinkActions(applied({ buildPreview: null }))).toEqual([]);
    expect(offeredLinkActions(applied({ buildPreview: undefined }))).toEqual([]);
  });

  it('draws nothing when the step is closed and the card has no other action', () => {
    const { container } = render(<PrescriptionActions siteId="site-1" prescription={applied({ buildPreview: null })} onChanged={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('stays out of a narrowed action set (the release report offers Revert only)', () => {
    const { container } = render(<PrescriptionActions siteId="site-1" prescription={applied()} only={['revert']} onChanged={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
