/**
 * Package a BUILT APP as something installable — a PWA, an Android APK, a signed
 * iOS `.ipa`.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * Real, working Capacitor / PWA / APK / IPA adapters already existed, and were
 * unreachable by anything that was not a game. `GameTargetContext` took a
 * `GameBuild` whose payload was ONE self-contained HTML document, so the modality
 * literally named "Mobile" — a multi-file react-native-web Vite app — had no path
 * to any of them. Its only "app on a phone" story was a QR code pointing at the
 * published website, which is a website.
 *
 * ── WHY THIS REUSES THE GAME REGISTRY RATHER THAN COPYING IT ────────────────
 * The expensive, easy-to-get-wrong parts are the packaging: the Capacitor project
 * definition, the bundle id rules Gradle fails late on, the icon set Safari
 * insists on, the runner workflows that build without a local toolchain. Those
 * are written once in `application/game/adapters/*` and are correct. Duplicating
 * them for apps would mean two sets of the same platform knowledge drifting apart
 * — the exact failure the `BackendHostingStrategy` port was created to avoid.
 *
 * So the INPUT was generalised instead: `GameBuild.webAssets` carries a built
 * `dist/`, the browser targets ship it when present, and this module is the door
 * an app comes through. The registry stays the registry.
 *
 * ── WHY THE BUILD ARRIVES FROM THE BROWSER ──────────────────────────────────
 * The same reason publishing does: the app is built in the WebContainer, in the
 * tab, and there is no server-side bundler. This takes the emitted `dist/`
 * exactly as `publishStaticSite` takes it, so the thing packaged into the APK is
 * byte-for-byte the thing that was previewed and published.
 */

import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { materializeGameTarget, type MaterializeGameResult } from '../game';
import { isGameTarget, type GameBuild, type GameTargetKey } from '../game/gameTarget';

/**
 * Targets an APP may be packaged for.
 *
 * `roblox` is excluded and always will be: it re-authors a brief against a
 * different engine and has no way to run a DOM app. `web` is excluded because an
 * app already has a better answer for "play it here" — the live preview and the
 * published site.
 */
export const APP_PACKAGE_TARGETS: readonly GameTargetKey[] = ['pwa', 'android', 'ios'];

export function isAppPackageTarget(value: unknown): value is GameTargetKey {
  return isGameTarget(value) && (APP_PACKAGE_TARGETS as readonly string[]).includes(value);
}

/** Text and binary halves of a built `dist/`, dist-relative. */
export interface AppBundle {
  files: Record<string, string>;
  binaryFiles: Record<string, Uint8Array>;
}

/** Lowercase alphanumeric + hyphen, non-empty — the same shape a slug must have. */
export function appSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'app';
}

/**
 * A stable accent colour for an app that never picked one.
 *
 * Derived from the name rather than random so re-packaging the same app produces
 * the same icons — a launcher icon that changes colour on every build looks like
 * a different app to the person who installed it.
 */
export function accentForApp(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  // Fixed saturation/lightness so every generated accent is legible against both
  // the light and dark chrome a launcher may put behind it.
  return hslToHex(hue, 62, 52);
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => {
    const value = lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * value).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export type PackageAppResult =
  | MaterializeGameResult
  | { ok: false; status: 422; reason: string };

/**
 * Package a built app for one target and write the project into the workspace.
 *
 * Returns whatever the shared materialiser returns, so the caller handles one
 * result shape whether the thing packaged was a game or an app.
 */
export async function packageAppTarget(args: {
  env: Env;
  db: Db;
  bucket: R2Bucket;
  tenantId: number;
  projectId: number;
  projectName: string;
  target: GameTargetKey;
  bundle: AppBundle;
  /** What the app is, for the store listing and the README. Optional. */
  description?: string;
  /** `#rrggbb`; derived from the name when absent. */
  accent?: string;
}): Promise<PackageAppResult> {
  if (!isAppPackageTarget(args.target)) {
    return {
      ok: false,
      status: 422,
      reason: `"${args.target}" is not an app packaging target. Use one of: ${APP_PACKAGE_TARGETS.join(', ')}.`,
    };
  }
  if (!args.bundle.files['index.html']) {
    return {
      ok: false,
      status: 422,
      reason: 'The build has no index.html at its root. Build the project first — the packaged app is the emitted dist/.',
    };
  }

  const title = args.projectName.trim().slice(0, 200) || 'App';
  const build: GameBuild = {
    title,
    slug: appSlug(title),
    brief: args.description?.trim().slice(0, 4000) || title,
    // Kept for the targets' own metadata; the bundle below is what actually
    // ships, because `webAssets` is set.
    html: args.bundle.files['index.html'],
    accent: /^#[0-9a-f]{6}$/i.test(args.accent ?? '') ? args.accent! : accentForApp(title),
    webAssets: args.bundle.files,
    binaryAssets: args.bundle.binaryFiles,
  };

  return materializeGameTarget({
    env: args.env,
    db: args.db,
    bucket: args.bucket,
    tenantId: args.tenantId,
    projectId: args.projectId,
    target: args.target,
    game: build,
  });
}
