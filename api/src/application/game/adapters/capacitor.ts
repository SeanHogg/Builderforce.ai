/**
 * The shared Capacitor project behind the `android` and `ios` targets.
 *
 * Both stores want a native binary that happens to render a web view. Capacitor
 * is the thinnest honest way to produce one: it wraps the SAME document the
 * canvas plays, so a game that works in the frame works in the APK, and there is
 * no second implementation to keep in sync.
 *
 * ── WHY THE NATIVE DIRECTORIES ARE NOT GENERATED HERE ───────────────────────
 * `npx cap add android` produces a Gradle project of several hundred files, and
 * `npx cap add ios` an Xcode project with a `.pbxproj` — both pinned to the exact
 * Capacitor version resolved at install time. Writing those by hand would mean
 * shipping a snapshot that silently rots against every Capacitor release. So the
 * repository carries the project DEFINITION (config, package manifest, web
 * assets) and the workflow runs `cap add` on the runner, where the versions are
 * whatever `npm install` just resolved. That is also why `android/` and `ios/`
 * are gitignored: they are build output, not source.
 *
 * ── WHY A RUNNER AND NOT YOUR MACHINE ───────────────────────────────────────
 * Building an APK needs the Android SDK; building for iOS needs macOS and Xcode.
 * A GitHub runner has both preinstalled. Pushing the generated directory is
 * therefore the entire local toolchain requirement — which is the difference
 * between "you can ship this" and "first install 12GB of tooling".
 */

import type { GameTargetContext } from '../gameTarget';
import { withTouchControls, injectIntoHead, escapeHtml } from '../gameDocument';
import { gameIconPng } from '../pngIcon';

/** The one directory both native targets materialise into. */
export function capacitorDirectory(slug: string): string {
  return `games/${slug}/app`;
}

/**
 * A valid Android application id / iOS bundle id.
 *
 * Reverse-DNS, and every segment must be a legal Java identifier: hyphens are
 * illegal, a leading digit is illegal, and Gradle fails late and unhelpfully on
 * both. The slug is sanitised rather than rejected because the author named a
 * game, not a package.
 */
export function bundleIdFor(slug: string): string {
  const segment = slug.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'game';
  return `ai.builderforce.game.${/^[0-9]/.test(segment) ? `g${segment}` : segment}`;
}

/**
 * The web assets both platforms wrap: the app, plus its icons.
 *
 * TWO INPUT SHAPES, ONE OUTPUT. A game is one self-contained document and gets
 * the touch layer injected into it. An APP (`game.webAssets`) is a built `dist/`
 * — many files, its own bundler-emitted `index.html` — copied under `www/`
 * unchanged apart from the head tags that point at the icons.
 *
 * The touch layer is deliberately NOT injected into an app bundle: it exists to
 * give a keyboard-driven game on-screen controls, and an app already has its own
 * interface. Adding it would put a D-pad over someone's login form.
 */
export function capacitorWebAssets(ctx: GameTargetContext): {
  files: Record<string, string>;
  binaryFiles: Record<string, Uint8Array>;
} {
  const { game } = ctx;
  const head = [
    `<meta name="theme-color" content="${escapeHtml(game.accent)}">`,
    `<link rel="icon" type="image/png" sizes="512x512" href="./icons/icon-512.png">`,
  ].join('\n');
  const files: Record<string, string> = {};
  const bundled: Record<string, Uint8Array> = {};
  if (game.webAssets) {
    for (const [path, contents] of Object.entries(game.webAssets)) {
      files[`www/${path}`] = path === 'index.html' ? injectIntoHead(contents, head) : contents;
    }
    for (const [path, bytes] of Object.entries(game.binaryAssets ?? {})) {
      bundled[`www/${path}`] = bytes;
    }
  } else {
    files['www/index.html'] = injectIntoHead(withTouchControls(game.html, game.accent), head);
  }
  return {
    files,
    binaryFiles: {
      ...bundled,
      'www/icons/icon-192.png': gameIconPng(192, game.accent),
      'www/icons/icon-512.png': gameIconPng(512, game.accent),
      // Capacitor's asset generator reads `resources/icon.png` (1024², opaque) to
      // produce every launcher and App Store size. Shipping it means the icon is
      // correct on both platforms from one file.
      'resources/icon.png': gameIconPng(1024, game.accent),
    },
  };
}

/** `capacitor.config.json`, `package.json` and `.gitignore` — the project itself. */
export function capacitorProjectFiles(ctx: GameTargetContext): Record<string, string> {
  const { game } = ctx;
  const appId = bundleIdFor(game.slug);

  const config = {
    appId,
    appName: game.title.slice(0, 30),
    webDir: 'www',
    // `https` scheme on Android so the web view has a secure context: without it
    // `crypto`, `localStorage` in some configurations, and any game that stores a
    // high score behave differently from the browser the game was tested in.
    server: { androidScheme: 'https' },
    android: { allowMixedContent: false },
    ios: { contentInset: 'always' },
  };

  const packageJson = {
    name: game.slug,
    version: '1.0.0',
    private: true,
    description: game.brief.slice(0, 200),
    scripts: {
      'add:android': 'cap add android',
      'add:ios': 'cap add ios',
      sync: 'cap sync',
      'open:android': 'cap open android',
      'open:ios': 'cap open ios',
    },
    devDependencies: {
      '@capacitor/cli': '^7.0.0',
      '@capacitor/assets': '^3.0.5',
    },
    dependencies: {
      '@capacitor/core': '^7.0.0',
      '@capacitor/android': '^7.0.0',
      '@capacitor/ios': '^7.0.0',
    },
  };

  return {
    'capacitor.config.json': `${JSON.stringify(config, null, 2)}\n`,
    'package.json': `${JSON.stringify(packageJson, null, 2)}\n`,
    '.gitignore':
      '# Native projects are generated by `npx cap add` on the build runner.\n'
      + '# They are pinned to the Capacitor version resolved at install time, so\n'
      + '# committing them means shipping a snapshot that rots. Do not check them in.\n'
      + 'android/\nios/\nnode_modules/\n*.apk\n*.aab\n*.ipa\n',
    'README.md': renderReadme(ctx, appId),
  };
}

function renderReadme(ctx: GameTargetContext, appId: string): string {
  const { game } = ctx;
  return `# ${game.title} — mobile app

${game.brief}

This wraps the generated game in a native shell so it can be installed from a
store or sideloaded. The game itself is \`www/index.html\` — the same document the
canvas plays, with a touch control layer added.

**Application id:** \`${appId}\`

## You do not need a local toolchain

Push this directory to a GitHub repository connected to this project. Two
workflows are included:

| Workflow | Runner | Produces |
| --- | --- | --- |
| \`.github/workflows/${game.slug}-android.yml\` | \`ubuntu-latest\` | \`app-debug.apk\` — installable on any Android phone with "install unknown apps" enabled |
| \`.github/workflows/${game.slug}-ios.yml\` | \`macos-latest\` | a simulator build, and a signed \`.ipa\` once signing secrets are set |

Both upload their output as a build artifact you can download from the run page.

## If you do want to build locally

\`\`\`bash
npm install
npx cap add android          # or: npx cap add ios
npx cap sync
npx cap open android         # opens Android Studio / Xcode
\`\`\`

Android needs Android Studio and JDK 21. iOS needs macOS, Xcode and CocoaPods.

## Updating the game

Regenerate the game on the canvas and re-materialise this target. Only
\`www/index.html\` and the icons change; the native projects are rebuilt from
scratch on every run, so there is nothing to migrate.

## Signing

The Android workflow produces a **debug-signed** APK. That installs on your own
phone but cannot go to Google Play. To publish, add a release keystore and switch
the Gradle task to \`bundleRelease\`.

The iOS workflow builds unsigned for the simulator by default. Set
\`IOS_CERTIFICATE_P12\`, \`IOS_CERTIFICATE_PASSWORD\` and \`IOS_PROVISIONING_PROFILE\`
as repository secrets and it will produce a signed \`.ipa\` instead.
`;
}
