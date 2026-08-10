/**
 * `android` — the game as a real APK, built on a runner.
 *
 * The whole point of this target is that it costs no local toolchain. Android
 * Studio plus an SDK is ~12GB and a working afternoon; `ubuntu-latest` already
 * has the SDK, so the build happens there and the artifact comes back as a
 * downloadable APK. That is a genuinely installable app — sideload it and it runs
 * offline with a launcher icon.
 *
 * It is DEBUG-signed. That is stated everywhere it appears rather than glossed,
 * because a debug APK installs on your own phone and cannot go to Play, and
 * discovering that after building a store listing is an expensive surprise. The
 * release path is a keystore and one changed Gradle task, documented in the
 * generated README.
 *
 * Shares its Capacitor project and its CI with {@link iosTarget} — see
 * `capacitor.ts` and `capacitorWorkflows.ts`.
 */

import type { GameTarget, GameTargetContext, GameTargetResult } from '../gameTarget';
import { repositorySetupStep } from '../gameTarget';
import { capacitorDirectory, capacitorProjectFiles, capacitorWebAssets } from './capacitor';
import { capacitorWorkflowFiles } from './capacitorWorkflows';

export const androidTarget: GameTarget = {
  key: 'android',
  label: 'Android app (APK)',
  summary:
    'A real Capacitor app plus an Action that builds an installable APK on a runner. '
    + 'No Android Studio, no SDK, no local build.',
  zeroSetup: false,
  device: 'phone',
  directory: capacitorDirectory,
  materialize(ctx: GameTargetContext): GameTargetResult {
    const assets = capacitorWebAssets(ctx);
    return {
      files: { ...capacitorProjectFiles(ctx), ...assets.files },
      binaryFiles: assets.binaryFiles,
      rootFiles: capacitorWorkflowFiles(ctx),
      setupSteps: [
        repositorySetupStep(ctx),
        {
          key: 'android:run',
          label: 'Run the Android workflow',
          detail:
            'The workflow runs on push, or immediately from the Actions tab. It takes about five minutes '
            + 'and attaches the APK to the run as a downloadable artifact.',
          blocking: false,
        },
        {
          key: 'android:sideload',
          label: 'Allow installing from unknown sources',
          detail:
            'A debug-signed APK is not from the Play Store, so Android asks for permission the first time '
            + 'you open one. This APK installs on your own phone; publishing to Play needs a release keystore.',
          blocking: false,
        },
      ],
      playUrl: null,
      detail: `Capacitor project + GitHub Actions build → ${ctx.game.slug}.apk (debug-signed)`,
    };
  },
};
