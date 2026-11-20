/**
 * The VS Code extension's composer commands (PRD 31 §W11, "Local launch from the VSIX"):
 * `/starter-kit`, `/manifest init` and `/launch`, injected into brain-embedded's registry
 * (`/help` is built in). Pure: the host passes what it knows about the workspace.
 *
 * The kits and extras come from the `ide-templates` part registry (`listKitOptions`) —
 * never a second list — so a part added there is offered here and in `/help` with no edit.
 */
import type {
  ComposerCommand,
  ComposerCommandAvailability,
  ComposerCommandChoice,
} from "@seanhogg/builderforce-brain-embedded/composerCommands";
import { listKitOptions, type KitPartOption } from "@builderforce/ide-templates/kits";

export const STARTER_KIT_COMMAND_ID = "starter-kit";
export const MANIFEST_COMMAND_ID = "manifest";
export const LAUNCH_COMMAND_ID = "launch";
export const MANIFEST_INIT_ACTION = "init";
export const LAUNCH_STOP = "stop";
export const LAUNCH_TRUST = "trust";

export interface ComposerCommandContext {
  /** A workspace folder is open. Every command here works on one. */
  hasWorkspace: boolean;
  /** Why not, in the person's language (shown disabled with this reason, never hidden). */
  noWorkspaceReason: string;
  /**
   * `/launch`'s environment choices: those the open folders' `builderforce.json` files
   * declare, when readable (several folders ⇒ each labelled with the folders declaring it).
   */
  environments?: readonly ComposerCommandChoice[];
  /** Why `/launch` cannot run in this host even with a folder open (a remote extension host). */
  launchUnavailableReason?: string;
  /** The label of the `stop` choice. */
  stopLabel: string;
  /** The label of the `trust` choice (trust the launcher's local certificate again). */
  trustLabel: string;
}

/** The short name a kit id uses for a part: its first alias (`react-vite` → `react`), else its id. */
function shortName(part: KitPartOption): string {
  return part.aliases[0] ?? part.id;
}

/** Every kit `/starter-kit` accepts: the named kits, every frontend × backend pair, then each frontend alone. */
export function starterKitChoices(): ComposerCommandChoice[] {
  const { frontends, backends, namedKits } = listKitOptions();
  const choices: ComposerCommandChoice[] = [];
  const seen = new Set<string>();
  const add = (value: string, label?: string): void => {
    if (seen.has(value)) return;
    seen.add(value);
    choices.push(label ? { value, label } : { value });
  };
  for (const kit of namedKits) add(kit);
  for (const frontend of frontends) {
    for (const backend of backends) add(`${shortName(frontend)}-${shortName(backend)}`, `${frontend.label} + ${backend.label}`);
  }
  for (const frontend of frontends) add(shortName(frontend), frontend.label);
  return choices;
}

/** The extras `--with` accepts. */
export function starterKitExtraChoices(): ComposerCommandChoice[] {
  return listKitOptions().extras.map((extra) => ({ value: extra.id, label: extra.label }));
}

export function buildComposerCommands(context: ComposerCommandContext): ComposerCommand[] {
  const availability: ComposerCommandAvailability = context.hasWorkspace
    ? { ok: true }
    : { ok: false, reason: context.noWorkspaceReason };
  const launchAvailability: ComposerCommandAvailability = availability.ok && context.launchUnavailableReason !== undefined
    ? { ok: false, reason: context.launchUnavailableReason }
    : availability;
  const kits = starterKitChoices();
  const extras = starterKitExtraChoices();
  const environments = context.environments ?? [];
  const exampleKit = kits[0]?.value ?? "react-node";
  const exampleExtra = extras[0]?.value;
  return [
    {
      id: STARTER_KIT_COMMAND_ID,
      syntax: "/starter-kit <kit> [--with <extra,...>]",
      args: [{ name: "kit", required: true, choices: kits }],
      flags: [{ name: "with", multiple: true, choices: extras }],
      example: exampleExtra ? `/starter-kit ${exampleKit} --with ${exampleExtra}` : `/starter-kit ${exampleKit}`,
      availability,
    },
    {
      id: MANIFEST_COMMAND_ID,
      syntax: "/manifest init",
      args: [{ name: "action", required: true, choices: [{ value: MANIFEST_INIT_ACTION }] }],
      example: "/manifest init",
      availability,
    },
    {
      id: LAUNCH_COMMAND_ID,
      syntax: "/launch [environment | stop | trust]",
      args: [{
        name: "environment",
        required: false,
        // With no readable manifest any environment name is passed through to the launcher, which names a bad one.
        ...(environments.length > 0
          ? {
              choices: [
                ...environments,
                { value: LAUNCH_STOP, label: context.stopLabel },
                { value: LAUNCH_TRUST, label: context.trustLabel },
              ],
            }
          : {}),
      }],
      example: environments[0] ? `/launch ${environments[0].value}` : "/launch",
      availability: launchAvailability,
    },
  ];
}
