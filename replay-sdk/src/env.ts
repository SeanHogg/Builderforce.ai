/**
 * The page environment a chunk header describes: device class, viewport and
 * document size, browser, OS and referrer host. Coarse on purpose — no
 * fingerprinting (PRD 33 §7).
 */

import type { ReplayDevice, ReplayDeviceClass } from '@builderforce/interaction-contract';

export function deviceClass(viewportW: number): ReplayDeviceClass {
  if (viewportW < 640) return 'phone';
  if (viewportW < 1024) return 'tablet';
  return 'desktop';
}

export function docSize(): { docW: number; docH: number } {
  const el = document.documentElement;
  const body = document.body;
  return {
    docW: Math.max(el ? el.scrollWidth : 0, body ? body.scrollWidth : 0, window.innerWidth || 0),
    docH: Math.max(el ? el.scrollHeight : 0, body ? body.scrollHeight : 0, window.innerHeight || 0),
  };
}

export function deviceInfo(): ReplayDevice {
  const w = window.innerWidth || 0;
  const h = window.innerHeight || 0;
  return { class: deviceClass(w), w, h, ...docSize() };
}

/** Ordered: the first pattern that matches names the browser. */
const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  [/Edg\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser/, 'Samsung Internet'],
  [/Firefox\/|FxiOS/, 'Firefox'],
  [/Chrome\/|CriOS/, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: ReadonlyArray<[RegExp, string]> = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Linux/, 'Linux'],
];

function first(table: ReadonlyArray<[RegExp, string]>, ua: string): string | undefined {
  for (const [pattern, name] of table) if (pattern.test(ua)) return name;
  return undefined;
}

export function browserOf(ua: string): string | undefined {
  return first(BROWSERS, ua);
}

export function osOf(ua: string): string | undefined {
  return first(SYSTEMS, ua);
}

/** The referrer's host when it is another site; never the full URL. */
export function referrerHost(referrer: string, ownHost: string): string | undefined {
  if (!referrer) return undefined;
  try {
    const host = new URL(referrer).hostname;
    return host && host !== ownHost ? host.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}
