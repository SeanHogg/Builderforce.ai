/**
 * `ios` — the game as an iOS app, built on a macOS runner.
 *
 * iOS is the target where honesty costs the most, so it is worth being precise
 * about what this produces. Apple will not let anyone install an app on a
 * physical iPhone without a signing identity tied to a paid Developer Program
 * membership — no runner, no CI trick and no wrapper changes that. What CI CAN do
 * with no account at all is build the app for the SIMULATOR, which proves the
 * project compiles and lets you play it on a Mac.
 *
 * So this target has two modes and picks between them by whether the signing
 * secrets exist:
 *
 *   no secrets  → an unsigned simulator build. Real, verifiable, free, and not
 *                 installable on a phone.
 *   secrets set → a signed, archived `.ipa` you can distribute through TestFlight.
 *
 * The workflow does not pretend the second is happening when it is not, and the
 * setup steps say plainly which one you are getting. For actually playing the
 * game on an iPhone today, the `pwa` target is the answer — it installs to the
 * home screen, runs fullscreen and offline, and needs no Apple account.
 *
 * Shares its Capacitor project and its CI with {@link androidTarget} — see
 * `capacitor.ts` and `capacitorWorkflows.ts`.
 */

import type { GameTarget, GameTargetContext, GameTargetResult } from '../gameTarget';
import { missingGameSecretSteps, repositorySetupStep } from '../gameTarget';
import { capacitorDirectory, capacitorProjectFiles, capacitorWebAssets } from './capacitor';
import { capacitorWorkflowFiles } from './capacitorWorkflows';

/** Signing inputs. Absent → simulator build; present → a distributable `.ipa`. */
export const IOS_SIGNING_SECRETS = [
  {
    name: 'IOS_CERTIFICATE_P12',
    label: 'Add your Apple distribution certificate (IOS_CERTIFICATE_P12)',
    detail:
      'Base64 of the .p12 exported from Keychain Access. Without it the workflow builds for the '
      + 'simulator only — which compiles and runs on a Mac, but cannot be installed on a phone. '
      + 'Apple requires a paid Developer Program membership to sign for devices.',
    url: 'https://developer.apple.com/account/resources/certificates/list',
  },
  {
    name: 'IOS_CERTIFICATE_PASSWORD',
    label: 'Add the certificate password (IOS_CERTIFICATE_PASSWORD)',
    detail: 'The password you set when exporting the .p12.',
  },
  {
    name: 'IOS_PROVISIONING_PROFILE',
    label: 'Add your provisioning profile (IOS_PROVISIONING_PROFILE)',
    detail:
      'Base64 of the .mobileprovision for this app id. It has to name the exact bundle id the '
      + 'project was generated with, or the archive step fails with a signing mismatch.',
    url: 'https://developer.apple.com/account/resources/profiles/list',
  },
] as const;

export const iosTarget: GameTarget = {
  key: 'ios',
  label: 'iPhone app (Xcode)',
  summary:
    'A real Capacitor app plus a macOS Action. Builds for the simulator with no Apple account; '
    + 'produces a distributable .ipa once signing secrets are set.',
  zeroSetup: false,
  device: 'phone',
  directory: capacitorDirectory,
  materialize(ctx: GameTargetContext): GameTargetResult {
    const assets = capacitorWebAssets(ctx);
    const signing = missingGameSecretSteps(ctx, IOS_SIGNING_SECRETS);
    return {
      files: { ...capacitorProjectFiles(ctx), ...assets.files },
      binaryFiles: assets.binaryFiles,
      rootFiles: capacitorWorkflowFiles(ctx),
      setupSteps: [
        repositorySetupStep(ctx),
        ...signing,
        {
          key: 'ios:play-now',
          label: 'To play on an iPhone today, install the web app instead',
          detail:
            'Apple requires a paid Developer Program membership to install an app on a physical device, '
            + 'so the free path is the published web app: open it in Safari, Share → Add to Home Screen, '
            + 'and it runs fullscreen and offline with its own icon.',
          blocking: false,
        },
      ],
      playUrl: null,
      detail: signing.length
        ? 'Capacitor project + macOS Actions build → unsigned simulator app (add signing secrets for an .ipa)'
        : `Capacitor project + macOS Actions build → signed ${ctx.game.slug}.ipa`,
    };
  },
};
