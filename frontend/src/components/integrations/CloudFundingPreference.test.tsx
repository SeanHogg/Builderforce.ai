/**
 * The cloud-funding card is a REAL radio group for the keyboard — the shared
 * `useRovingRadioGroup` the inference-mode control uses: one tab stop (the chosen order),
 * Arrow keys move focus (wrapping), and moving focus never chooses.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CLOUD_ORDERS } from '@builderforce/model-catalog';

const choose = vi.fn();
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('./useCloudFundingPreference', () => ({
  useCloudFundingPreference: () => ({ cloudOrder: CLOUD_ORDERS[1], choose, saving: false, loadFailed: false, saveFailed: false }),
}));

const { CloudFundingPreference } = await import('./CloudFundingPreference');

describe('<CloudFundingPreference> keyboard', () => {
  it('has one tab stop on the chosen order and moves focus with the arrow keys', () => {
    render(<CloudFundingPreference />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(CLOUD_ORDERS.length);
    expect(radios.map((radio) => radio.tabIndex)).toEqual(CLOUD_ORDERS.map((_, index) => (index === 1 ? 0 : -1)));
    radios[1]!.focus();
    fireEvent.keyDown(radios[1]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(radios[2 % radios.length]);
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(radios[0]);
    fireEvent.keyDown(radios[0]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(radios[radios.length - 1]);
    // Focus moved; nothing was chosen.
    expect(choose).not.toHaveBeenCalled();
  });
});
