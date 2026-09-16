/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { installMatchMedia, PHONE_VIEWPORT_MAX_WIDTH } from '@/test/phoneViewport';
import { usePhoneViewport } from './usePhoneViewport';

function Probe() {
  const phone = usePhoneViewport();
  return <div data-testid="probe" data-phone={phone ? 'yes' : 'no'} />;
}

describe('usePhoneViewport', () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('is false in jsdom until a matchMedia is installed', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveAttribute('data-phone', 'no');
  });

  it(`is true at ${PHONE_VIEWPORT_MAX_WIDTH}px and false one pixel above`, async () => {
    const handle = installMatchMedia(PHONE_VIEWPORT_MAX_WIDTH);
    restore = handle.restore;
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveAttribute('data-phone', 'yes'));

    act(() => handle.setWidth(PHONE_VIEWPORT_MAX_WIDTH + 1));
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveAttribute('data-phone', 'no'));
  });
});
