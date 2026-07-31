import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, within, cleanup } from '@testing-library/react';
import { DevicePreview } from './DevicePreview';
import { QrCode } from './QrCode';
import { DEVICE_PRESETS, getDevicePreset } from '@/lib/devicePresets';

/**
 * The IDE's modality test mocks these components out, so without this file
 * nothing ever renders them. What matters here is the behaviour the device
 * simulator exists for: the previewed app must lay out against the DEVICE's
 * viewport, not the pane's, and rotating or switching device must change that
 * viewport.
 */

describe('DevicePreview', () => {
  beforeEach(() => cleanup());

  const noop = () => {};

  it('renders the iframe at the selected device viewport, not the pane size', () => {
    const { getByTitle } = render(<DevicePreview url="http://localhost:5173" onOpenDevicePanel={noop} />);
    const iphone = getDevicePreset('iphone-15-pro');
    const screenEl = getByTitle('ide.device.previewTitle').parentElement!;
    expect(screenEl.style.width).toBe(`${iphone.width}px`);
    expect(screenEl.style.height).toBe(`${iphone.height}px`);
  });

  it('swaps width and height when rotated', () => {
    const { getByTitle, getByLabelText } = render(
      <DevicePreview url="http://localhost:5173" onOpenDevicePanel={noop} />,
    );
    const iphone = getDevicePreset('iphone-15-pro');
    fireEvent.click(getByLabelText('ide.device.rotate'));
    const screenEl = getByTitle('ide.device.previewTitle').parentElement!;
    expect(screenEl.style.width).toBe(`${iphone.height}px`);
    expect(screenEl.style.height).toBe(`${iphone.width}px`);
  });

  // `Select` is the app's custom themed listbox, not a native <select>: its
  // options only exist once the popup is open, so drive it by clicking.
  it('re-sizes the viewport when a different device is picked', () => {
    const { getByTitle, getByLabelText, getByRole } = render(
      <DevicePreview url="http://localhost:5173" onOpenDevicePanel={noop} />,
    );
    fireEvent.click(getByLabelText('ide.device.deviceLabel'));
    fireEvent.click(within(getByRole('listbox')).getByText('iPad mini'));

    const ipad = getDevicePreset('ipad-mini');
    const screenEl = getByTitle('ide.device.previewTitle').parentElement!;
    expect(screenEl.style.width).toBe(`${ipad.width}px`);
    expect(screenEl.style.height).toBe(`${ipad.height}px`);
  });

  it('offers every device preset', () => {
    const { getByLabelText, getByRole } = render(<DevicePreview url="http://x" onOpenDevicePanel={noop} />);
    fireEvent.click(getByLabelText('ide.device.deviceLabel'));
    const options = within(getByRole('listbox')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(DEVICE_PRESETS.map((d) => d.label));
  });

  it('shows the empty state and no iframe before the first run', () => {
    const { queryByTitle, getByText } = render(<DevicePreview onOpenDevicePanel={noop} />);
    expect(queryByTitle('ide.device.previewTitle')).toBeNull();
    expect(getByText('ide.device.emptyTitle')).toBeTruthy();
  });

  // Reload and open-in-tab act on a URL; offering them with nothing running
  // would be a dead click.
  it('disables the run-dependent controls until there is a preview URL', () => {
    const { getByLabelText, rerender } = render(<DevicePreview onOpenDevicePanel={noop} />);
    expect((getByLabelText('ide.device.reload') as HTMLButtonElement).disabled).toBe(true);
    expect((getByLabelText('ide.device.openInTab') as HTMLButtonElement).disabled).toBe(true);

    rerender(<DevicePreview url="http://localhost:5173" onOpenDevicePanel={noop} />);
    expect((getByLabelText('ide.device.reload') as HTMLButtonElement).disabled).toBe(false);
  });

  it('opens the scan-to-phone panel from the toolbar', () => {
    const onOpen = vi.fn();
    const { getByText } = render(<DevicePreview url="http://x" onOpenDevicePanel={onOpen} />);
    fireEvent.click(getByText('ide.device.tryOnDevice'));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe('QrCode', () => {
  beforeEach(() => cleanup());

  it('renders a square SVG symbol for a URL', () => {
    const { getByRole } = render(<QrCode value="https://my-app.apps.builderforce.ai" label="scan me" />);
    const svg = getByRole('img', { name: 'scan me' });
    const [, , w, h] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(w).toBe(h);
    // Version 1 (21 modules) plus the 4-module quiet zone on each side.
    expect(w).toBeGreaterThanOrEqual(29);
    expect(svg.querySelector('path')?.getAttribute('d')).toBeTruthy();
  });

  // A code that can't be encoded must not render as a broken symbol — the link
  // itself is still usable.
  it('falls back to the raw value when the payload will not fit', () => {
    const tooLong = 'a'.repeat(300);
    const { queryByRole, getByText } = render(<QrCode value={tooLong} label="scan me" />);
    expect(queryByRole('img')).toBeNull();
    expect(getByText(tooLong)).toBeTruthy();
  });
});
