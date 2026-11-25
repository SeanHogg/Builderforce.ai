/**
 * The COMPOSER COMMAND contract — what a person may type after `/` in a composer
 * (`/starter-kit angular-node --with postgres`, `/manifest init`, `/help`).
 *
 * Not to be confused with the model's tools in `BrainActionsContext` ("actions"): a
 * composer command is typed by the PERSON, parsed deterministically, and never reaches
 * a model. Pure data, no React, no DOM — the VS Code extension HOST, the VS Code
 * webview and the web composer all read the same registry.
 *
 * The registry holds ids and syntax only. Every sentence a person reads (a command's
 * description, a problem's wording) comes from the host's localized labels.
 */

/** One allowed value of an argument or flag. `value` is the stable id; `label` is display text. */
export interface ComposerCommandChoice {
  value: string;
  label?: string;
}

/** A positional argument, in order. A `multiple` one must be last and takes every remaining value. */
export interface ComposerCommandArg {
  name: string;
  required: boolean;
  /** When set, a value must be one of these (matched case-insensitively, returned canonical). */
  choices?: ComposerCommandChoice[];
  /**
   * With `choices`: they are suggestions, not a closed list. A value matching one is still
   * returned canonical; any other value passes through as typed (a path beside environment names).
   */
  open?: boolean;
  /** Comma-separated and/or space-separated values collected into a list. */
  multiple?: boolean;
}

/** A `--name value` / `--name=v1,v2` option. */
export interface ComposerCommandFlag {
  name: string;
  required?: boolean;
  choices?: ComposerCommandChoice[];
  /** Comma-separated values, and repeats, collect into a list. */
  multiple?: boolean;
}

/** Whether the current host / plan can run a command. Unavailable ⇒ shown disabled with the reason, never hidden. */
export type ComposerCommandAvailability = { ok: true } | { ok: false; reason: string };

export interface ComposerCommand {
  /** Lowercase `[a-z][a-z-]*` — what follows the `/`. */
  id: string;
  /** Typed syntax shown in help, e.g. `/starter-kit <kit> [--with <extra,...>]`. */
  syntax: string;
  args: ComposerCommandArg[];
  flags?: ComposerCommandFlag[];
  /** A complete, runnable example, e.g. `/starter-kit angular-node --with postgres`. */
  example: string;
  /** Omitted ⇒ available. */
  availability?: ComposerCommandAvailability;
}

/** The host's localized text for the registry. `describe(id)` is the one-line description of a command. */
export interface ComposerCommandLabels {
  describe: (id: string) => string;
}

/** Why a typed command does not parse. Structured so the host words it in the person's language. */
export type ComposerCommandProblem =
  | { code: 'missing-arg'; name: string }
  | { code: 'missing-flag'; name: string }
  | { code: 'missing-value'; name: string }
  | { code: 'bad-choice'; name: string; value: string; choices: string[] }
  | { code: 'unknown-flag'; name: string }
  | { code: 'duplicate-flag'; name: string }
  | { code: 'extra-arg'; value: string };

/** What a composer's input is. Only `command` runs a command; `message` / `escaped` go to the chat as usual. */
export type ComposerInput =
  | { kind: 'message' }
  | { kind: 'escaped'; text: string }
  | { kind: 'command'; id: string; args: Record<string, string | string[]>; raw: string }
  | { kind: 'invalid'; id: string; problems: ComposerCommandProblem[] }
  | { kind: 'unavailable'; id: string; reason: string }
  | { kind: 'unknown'; name: string };

/** One rendered `/help` entry — everything a host needs to draw it, no wording left to invent. */
export interface ComposerHelpEntry {
  id: string;
  syntax: string;
  description: string;
  args: ComposerCommandArg[];
  flags: ComposerCommandFlag[];
  example: string;
  availability: ComposerCommandAvailability;
  /** No required argument or flag — choosing it can run `/<id>` straight away. */
  runnable: boolean;
  /** What to put in the composer when the entry needs arguments: `/<id> `. */
  insertText: string;
}

/** The `/help` model. `unknown` is set when it answers a command that does not exist ("no such command"). */
export interface ComposerHelpModel {
  entries: ComposerHelpEntry[];
  unknown?: string;
}

export interface ComposerCommandRegistry {
  /** Every command, the built-in `help` first. */
  list(): readonly ComposerCommand[];
  get(id: string): ComposerCommand | undefined;
  /** No id ⇒ every entry. A registered id ⇒ that entry alone. An unregistered id ⇒ {@link helpForUnknown}. */
  help(id?: string): ComposerHelpModel;
  /** "No such command" + the full list. */
  helpForUnknown(name: string): ComposerHelpModel;
}
