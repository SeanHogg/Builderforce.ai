/**
 * GameTarget — the port for "where does this game actually get played?".
 *
 * Canvas could already AUTHOR a game: `creative.game` asks a model for one
 * self-contained HTML document and hands back a file. That file was a deliverable
 * and nothing else — it could not be played without leaving the canvas, and it
 * certainly could not be played on the phone or the console the person asking for
 * a game had in mind. "Make me a game" and "give me a .html" are not the same
 * request, and the gap between them is this port.
 *
 * A target takes the authored game and produces the files that make it playable
 * somewhere specific. They are genuinely different answers with genuinely
 * different costs, and nobody should have to choose one before anything works:
 *
 *   `web`     — the document itself, played in a sandboxed frame on the canvas.
 *               Zero setup, zero latency, no account. This is the inner loop:
 *               change the brief, regenerate, play it again.
 *
 *   `pwa`     — the same game plus a manifest, a service worker, real icons and
 *               a touch layer, published to `<sub>.builderforce.ai`. Installs to
 *               the home screen on BOTH Android and iOS, runs fullscreen, runs
 *               offline. Still zero setup — this is what a phone plays today.
 *
 *   `android` — a real Capacitor project plus an Action that builds a real APK on
 *               a runner. Costs a GitHub repo; costs no local toolchain.
 *
 *   `ios`     — the same Capacitor project plus a macOS Action. Builds a
 *               simulator app unsigned, and an `.ipa` once signing secrets exist.
 *
 *   `roblox`  — not a port of the HTML at all. Roblox is a different machine: Luau
 *               on a server-authoritative engine, not a canvas in a browser. The
 *               brief is re-authored against that engine and evaluated into a real
 *               `.rbxlx` place, a Rojo project, and an Open Cloud publish.
 *
 * ── WHY THIS IS A PORT AND NOT FIVE FUNCTIONS ───────────────────────────────
 * The expensive parts — validating that the generated document IS a playable
 * game, the touch layer, the icon set, the slug, the setup-step vocabulary — are
 * written ONCE here and shared. A sixth target (a desktop wrapper, a console
 * export) lands as an adapter rather than a rewrite. This is deliberately the
 * same shape as {@link BackendHostingStrategy}, because it is the same problem:
 * one authored artifact, several honest places to run it.
 */

import type { SetupStep } from '../backend/hostingStrategy';

export const GAME_TARGETS = ['web', 'pwa', 'android', 'ios', 'roblox'] as const;
export type GameTargetKey = (typeof GAME_TARGETS)[number];

export function isGameTarget(v: unknown): v is GameTargetKey {
  return typeof v === 'string' && (GAME_TARGETS as readonly string[]).includes(v);
}

/**
 * The authored game, normalised.
 *
 * `html` is ONE self-contained document — no external files, no network. Every
 * target that is a browser (web, pwa, android, ios) ships exactly this document,
 * so a game that plays on the canvas plays identically in the APK. Roblox ignores
 * it and re-authors from `brief`, because there is no honest way to run a DOM
 * game inside Roblox.
 */
export interface GameBuild {
  /** Human title, as the author typed it. */
  title: string;
  /** File- and URL-safe stem derived from the title. Never empty. */
  slug: string;
  /** The brief the game was generated from. Roblox re-authors against this. */
  brief: string;
  /** The self-contained playable document. */
  html: string;
  /** `#rrggbb`, derived from the title when the author picked nothing. */
  accent: string;
}

export interface GameTargetContext {
  projectId: number;
  tenantId: number;
  projectName: string;
  game: GameBuild;
  /** This API's public origin, for generated code that calls back. */
  apiOrigin: string;
  /** Where the PWA is published, when it has been. Null before the first publish. */
  siteUrl: string | null;
  /** Secret NAMES the project has stored. Values never cross this boundary. */
  secretNames: readonly string[];
  /**
   * Author a structured document with the platform's free model pool.
   *
   * Injected rather than imported so an adapter that needs a model stays a pure
   * function of its inputs — `roblox` is the only one that does, and being able
   * to hand it a canned spec is what makes the place emitter testable without a
   * key. Absent means no generator is available; an adapter that needs one must
   * say so in its setup steps rather than inventing content.
   */
  compose?: ComposeStructured;
}

/** Returns the parsed JSON the model produced, or throws. */
export type ComposeStructured = (args: {
  system: string;
  user: string;
  schema: unknown;
  maxTokens: number;
  useCase: string;
}) => Promise<unknown>;

export interface GameTargetResult {
  /**
   * Files under this target's own directory, target-relative. The service layer
   * prefixes them with {@link GameTarget.directory}; keeping them relative is
   * what lets the `pwa` target's output be published to a site root unchanged.
   */
  files: Record<string, string>;
  /**
   * Binary files, same rooting as {@link files}. Icons are PNG because Safari's
   * `apple-touch-icon` will not accept anything else, and an iOS home-screen
   * install with no usable icon shows a screenshot of the page instead.
   */
  binaryFiles?: Record<string, Uint8Array>;
  /**
   * Files that must live at the WORKSPACE ROOT, whatever the target's directory.
   *
   * The one real case is CI: GitHub only runs a workflow it finds at
   * `.github/workflows/`, so a target whose build happens on a runner cannot keep
   * its workflow beside its source. Explicit rather than letting adapters emit
   * absolute-looking paths into {@link files}, because that ambiguity is exactly
   * what would break the publish mapping.
   */
  rootFiles?: Record<string, string>;
  /** What the user still has to do. Ordered; blocking steps first. */
  setupSteps: SetupStep[];
  /** Where this target can be played, once its setup steps are done. */
  playUrl: string | null;
  /** One line the UI shows under the target: what was actually produced. */
  detail: string;
}

export interface GameTarget {
  key: GameTargetKey;
  label: string;
  summary: string;
  /** True when materialising is sufficient to play it — no account, no toolchain. */
  zeroSetup: boolean;
  /** What the player plays it on. Drives the icon and the grouping in the UI. */
  device: 'browser' | 'phone' | 'roblox';
  /**
   * Where this target's files live in the workspace.
   *
   * A function rather than a constant because `android` and `ios` deliberately
   * share ONE directory: they are the same Capacitor project built by two
   * different runners, and materialising them into separate trees would give the
   * user two copies of the same app to keep in sync.
   */
  directory(slug: string): string;
  materialize(ctx: GameTargetContext): GameTargetResult | Promise<GameTargetResult>;
}

/**
 * Missing-secret setup steps, shared by every adapter that needs credentials.
 *
 * Deliberately the same shape and the same prose as the backend port's version:
 * a user who has already stored a Twilio token for a project backend should not
 * meet a different vocabulary when they store a Roblox key for a game.
 */
export function missingGameSecretSteps(
  ctx: GameTargetContext,
  required: readonly { name: string; label: string; detail: string; url?: string }[],
): SetupStep[] {
  const have = new Set(ctx.secretNames);
  return required
    .filter((secret) => !have.has(secret.name))
    .map((secret) => ({
      key: `secret:${secret.name}`,
      label: secret.label,
      detail: secret.detail,
      ...(secret.url ? { url: secret.url } : {}),
      blocking: true,
    }));
}

/** A repo-backed target needs somewhere to run its build. Shared by android/ios. */
export function repositorySetupStep(ctx: GameTargetContext): SetupStep {
  return {
    key: 'repo:connect',
    label: 'Connect a GitHub repository to this project',
    detail:
      `The build runs on a GitHub Actions runner, not on your machine — that is what makes `
      + `an APK possible without installing Android Studio. Push the generated `
      + `${ctx.game.slug}/ directory to a repository connected to this project and the workflow `
      + `runs on the next push.`,
    blocking: true,
  };
}
