/**
 * The composer command registry: the host's entries plus the built-in `/help`, and the
 * `/help` MODEL rendered from them. Help is never hand-written copy — an entry added to
 * the registry appears in `/help` with no other edit (make.md §4 W11).
 *
 * Hosts inject the entries (the starter-kit entry is built by the host from
 * `ide-templates`, which a published package may not import).
 */
import type {
  ComposerCommand,
  ComposerCommandLabels,
  ComposerCommandRegistry,
  ComposerHelpEntry,
  ComposerHelpModel,
} from './types';

export const HELP_COMMAND_ID = 'help';

const COMMAND_ID = /^[a-z][a-z-]*$/;

function helpCommand(ids: string[]): ComposerCommand {
  return {
    id: HELP_COMMAND_ID,
    syntax: '/help [command]',
    args: [{ name: 'command', required: false, choices: ids.map((value) => ({ value })) }],
    example: ids[0] ? `/help ${ids[0]}` : '/help',
  };
}

function toHelpEntry(command: ComposerCommand, labels: ComposerCommandLabels): ComposerHelpEntry {
  const flags = command.flags ?? [];
  return {
    id: command.id,
    syntax: command.syntax,
    description: labels.describe(command.id),
    args: command.args,
    flags,
    example: command.example,
    availability: command.availability ?? { ok: true },
    runnable: !command.args.some((arg) => arg.required) && !flags.some((flag) => flag.required),
    insertText: `/${command.id} `,
  };
}

/**
 * Build the registry. Throws on a malformed id, a duplicate id, or an entry that claims
 * the reserved `help` — each a host programming error, caught by its own tests.
 */
export function createComposerCommandRegistry(entries: ComposerCommand[], labels: ComposerCommandLabels): ComposerCommandRegistry {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!COMMAND_ID.test(entry.id)) throw new Error(`Composer command id "${entry.id}" must match ${COMMAND_ID}`);
    if (entry.id === HELP_COMMAND_ID) throw new Error('Composer command "help" is built in');
    if (seen.has(entry.id)) throw new Error(`Composer command "${entry.id}" is registered twice`);
    seen.add(entry.id);
  }
  const commands: readonly ComposerCommand[] = [helpCommand(entries.map((entry) => entry.id)), ...entries];
  const byId = new Map(commands.map((command) => [command.id, command]));
  const all = (): ComposerHelpEntry[] => commands.map((command) => toHelpEntry(command, labels));

  const helpForUnknown = (name: string): ComposerHelpModel => ({ entries: all(), unknown: name });
  return {
    list: () => commands,
    get: (id) => byId.get(id),
    help: (id) => {
      if (id === undefined) return { entries: all() };
      const command = byId.get(id.toLowerCase());
      return command ? { entries: [toHelpEntry(command, labels)] } : helpForUnknown(id);
    },
    helpForUnknown,
  };
}
