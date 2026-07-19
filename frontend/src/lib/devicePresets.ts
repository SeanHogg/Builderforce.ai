/**
 * Device presets for the mobile IDE's simulator frame.
 *
 * Single source for the viewport sizes the Mobile modality previews against, so
 * the device picker, the bezel geometry and any future responsive check all read
 * the same numbers instead of inlining magic pixel values.
 *
 * `width`/`height` are CSS pixels of the DEVICE VIEWPORT (not the physical
 * panel) — the size the previewed app actually lays out against.
 */

export type DeviceNotch = 'dynamic-island' | 'notch' | 'none';

export interface DevicePreset {
  id: string;
  /** Shown in the device picker. Product names are brand tokens, not translated. */
  label: string;
  width: number;
  height: number;
  /** Corner radius of the screen, in device pixels. */
  radius: number;
  notch: DeviceNotch;
}

export const DEVICE_PRESETS: DevicePreset[] = [
  { id: 'iphone-15-pro', label: 'iPhone 15 Pro', width: 393, height: 852, radius: 47, notch: 'dynamic-island' },
  { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667, radius: 0, notch: 'none' },
  { id: 'pixel-8', label: 'Pixel 8', width: 412, height: 915, radius: 34, notch: 'none' },
  { id: 'galaxy-s23', label: 'Galaxy S23', width: 360, height: 780, radius: 32, notch: 'none' },
  { id: 'ipad-mini', label: 'iPad mini', width: 744, height: 1133, radius: 26, notch: 'none' },
];

export const DEFAULT_DEVICE_ID = 'iphone-15-pro';

/** Resolve a preset id to its definition, falling back to the default device. */
export function getDevicePreset(id: string | null | undefined): DevicePreset {
  return DEVICE_PRESETS.find((d) => d.id === id) ?? DEVICE_PRESETS[0];
}
