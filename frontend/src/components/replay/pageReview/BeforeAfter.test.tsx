import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { replayApi } from '@/lib/replayApi';
import { BeforeAfter, BEFORE_AFTER_MODES, type BeforeAfterShot } from './BeforeAfter';

/**
 * Before → after (PRD 33 §5.2 "Render"): a slider that is a real `input[type=range]`,
 * a toggle and side by side; either device; the before carries the numbered callouts;
 * no after render yet is said, not faked.
 */

const SHOTS: Partial<Record<'desktop' | 'phone', BeforeAfterShot>> = {
  desktop: { captureId: 'cap-d', beforePath: '/before-desktop', afterPath: '/after-desktop' },
  phone: { captureId: 'cap-p', beforePath: '/before-phone', afterPath: '/after-phone' },
};

beforeEach(() => {
  vi.spyOn(replayApi, 'captureAssetUrl').mockImplementation(async (path: string) => `blob:${path}`);
  vi.spyOn(replayApi, 'captureRects').mockResolvedValue([{ selector: '#cta', x: 10, y: 10, w: 100, h: 40, label: 'Buy', role: 'cta' }]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BeforeAfter', () => {
  it('slides between before and after with a range input', async () => {
    render(<BeforeAfter siteId="site-1" shots={SHOTS} callouts={[{ n: 1, selector: '#cta' }]} />);
    const slider = screen.getByRole('slider', { name: 'replay.page.beforeAfter.sliderAria' });
    expect(slider).toHaveAttribute('type', 'range');
    expect(screen.getByTestId('after-overlay')).toHaveAttribute('data-split', '50');
    fireEvent.change(slider, { target: { value: '20' } });
    expect(screen.getByTestId('after-overlay')).toHaveAttribute('data-split', '20');
    // The before carries the numbered callout from the rect map.
    expect(await screen.findByRole('button', { name: 'replay.page.calloutAria 1 Buy' })).toBeInTheDocument();
    expect(await screen.findByAltText('replay.page.beforeAfter.afterAlt')).toHaveAttribute('src', 'blob:/after-desktop');
  });

  it('offers slider, toggle and side by side', async () => {
    render(<BeforeAfter siteId="site-1" shots={SHOTS} callouts={[]} />);
    const modes = screen.getByRole('tablist', { name: 'replay.page.beforeAfter.modeAria' });
    expect([...modes.querySelectorAll('[data-mode]')].map((el) => el.getAttribute('data-mode'))).toEqual([...BEFORE_AFTER_MODES]);

    fireEvent.click(screen.getByRole('tab', { name: 'replay.page.beforeAfter.mode.toggle' }));
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByTestId('after-shot')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'replay.page.beforeAfter.after' }));
    expect(screen.getByTestId('after-shot')).toBeInTheDocument();
    expect(screen.queryByTestId('callout-shot')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'replay.page.beforeAfter.mode.side' }));
    expect(screen.getByTestId('callout-shot')).toBeInTheDocument();
    expect(screen.getByTestId('after-shot')).toBeInTheDocument();
  });

  it('switches device to the phone shots', async () => {
    render(<BeforeAfter siteId="site-1" shots={SHOTS} callouts={[]} />);
    fireEvent.click(screen.getByRole('tab', { name: /replay\.page\.device\.phone/ }));
    expect(screen.getByTestId('callout-shot')).toHaveAttribute('data-device', 'phone');
    await waitFor(() => expect(replayApi.captureAssetUrl).toHaveBeenCalledWith('/before-phone'));
    expect(replayApi.captureAssetUrl).toHaveBeenCalledWith('/after-phone');
    expect(replayApi.captureRects).toHaveBeenCalledWith('site-1', 'cap-p');
  });

  it('says the after is not rendered yet instead of inventing one', () => {
    render(<BeforeAfter siteId="site-1" shots={{ desktop: { captureId: 'cap-d', beforePath: '/before-desktop', afterPath: null } }} callouts={[]} />);
    expect(screen.getByText('replay.page.beforeAfter.afterPending')).toBeInTheDocument();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByRole('tab', { name: /replay\.page\.device/ })).toBeNull();
  });
});
