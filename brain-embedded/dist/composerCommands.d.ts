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
interface ComposerCommandChoice {
    value: string;
    label?: string;
}
/** A positional argument, in order. A `multiple` one must be last and takes every remaining value. */
interface ComposerCommandArg {
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
interface ComposerCommandFlag {
    name: string;
    required?: boolean;
    choices?: ComposerCommandChoice[];
    /** Comma-separated values, and repeats, collect into a list. */
    multiple?: boolean;
}
/** Whether the current host / plan can run a command. Unavailable ⇒ shown disabled with the reason, never hidden. */
type ComposerCommandAvailability = {
    ok: true;
} | {
    ok: false;
    reason: string;
};
interface ComposerCommand {
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
interface ComposerCommandLabels {
    describe: (id: string) => string;
}
/** Why a typed command does not parse. Structured so the host words it in the person's language. */
type ComposerCommandProblem = {
    code: 'missing-arg';
    name: string;
} | {
    code: 'missing-flag';
    name: string;
} | {
    code: 'missing-value';
    name: string;
} | {
    code: 'bad-choice';
    name: string;
    value: string;
    choices: string[];
} | {
    code: 'unknown-flag';
    name: string;
} | {
    code: 'duplicate-flag';
    name: string;
} | {
    code: 'extra-arg';
    value: string;
};
/** What a composer's input is. Only `command` runs a command; `message` / `escaped` go to the chat as usual. */
type ComposerInput = {
    kind: 'message';
} | {
    kind: 'escaped';
    text: string;
} | {
    kind: 'command';
    id: string;
    args: Record<string, string | string[]>;
    raw: string;
} | {
    kind: 'invalid';
    id: string;
    problems: ComposerCommandProblem[];
} | {
    kind: 'unavailable';
    id: string;
    reason: string;
} | {
    kind: 'unknown';
    name: string;
};
/** One rendered `/help` entry — everything a host needs to draw it, no wording left to invent. */
interface ComposerHelpEntry {
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
interface ComposerHelpModel {
    entries: ComposerHelpEntry[];
    unknown?: string;
}
interface ComposerCommandRegistry {
    /** Every command, the built-in `help` first. */
    list(): readonly ComposerCommand[];
    get(id: string): ComposerCommand | undefined;
    /** No id ⇒ every entry. A registered id ⇒ that entry alone. An unregistered id ⇒ {@link helpForUnknown}. */
    help(id?: string): ComposerHelpModel;
    /** "No such command" + the full list. */
    helpForUnknown(name: string): ComposerHelpModel;
}

/**
 * The deterministic composer command parser (make.md §4 W11, Rev 2 item 10). It never
 * calls a model: a typed command either parses into a registered command, or it is
 * answered as invalid / unavailable / unknown — it never falls through to the chat.
 *
 * - A command is ONLY `^/[a-z][a-z-]*(\s|$)`: `/api/users returns 500` and `/Help` are
 *   ordinary messages.
 * - `//…` escapes a leading slash: the message is sent with one slash removed.
 * - A lone `/` is a message here — the `/` menu owns it (its keyboard selection wins).
 * - After the name: positional arguments, then `--flag value` or `--flag=v1,v2`.
 */

/** Classify a composer's input. Deterministic; never calls a model. */
declare function parseComposerInput(text: string, registry: Pick<ComposerCommandRegistry, 'get'>): ComposerInput;
/** English wording for a problem — the default a host overrides with its own catalog. */
declare function describeComposerProblem(problem: ComposerCommandProblem): string;

/**
 * The composer command registry: the host's entries plus the built-in `/help`, and the
 * `/help` MODEL rendered from them. Help is never hand-written copy — an entry added to
 * the registry appears in `/help` with no other edit (make.md §4 W11).
 *
 * Hosts inject the entries (the starter-kit entry is built by the host from
 * `ide-templates`, which a published package may not import).
 */

declare const HELP_COMMAND_ID = "help";
/**
 * Build the registry. Throws on a malformed id, a duplicate id, or an entry that claims
 * the reserved `help` — each a host programming error, caught by its own tests.
 */
declare function createComposerCommandRegistry(entries: ComposerCommand[], labels: ComposerCommandLabels): ComposerCommandRegistry;

export { type ComposerCommand, type ComposerCommandArg, type ComposerCommandAvailability, type ComposerCommandChoice, type ComposerCommandFlag, type ComposerCommandLabels, type ComposerCommandProblem, type ComposerCommandRegistry, type ComposerHelpEntry, type ComposerHelpModel, type ComposerInput, HELP_COMMAND_ID, createComposerCommandRegistry, describeComposerProblem, parseComposerInput };
