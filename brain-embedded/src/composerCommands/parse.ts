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
import type {
  ComposerCommand,
  ComposerCommandChoice,
  ComposerCommandProblem,
  ComposerCommandRegistry,
  ComposerInput,
} from './types';

const COMMAND = /^\/([a-z][a-z-]*)(?:\s|$)/;

/** Split on whitespace, keeping `"quoted words"` / `'quoted words'` together. */
function tokenize(rest: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let match = pattern.exec(rest); match; match = pattern.exec(rest)) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return tokens;
}

function splitList(value: string): string[] {
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

/** The canonical choice value for `value` (case-insensitive), or undefined when it is not allowed. */
function matchChoice(value: string, choices: ComposerCommandChoice[]): string | undefined {
  const wanted = value.toLowerCase();
  return choices.find((choice) => choice.value.toLowerCase() === wanted)?.value;
}

function checkChoices(
  name: string,
  values: string[],
  choices: ComposerCommandChoice[] | undefined,
  problems: ComposerCommandProblem[],
  open = false,
): string[] {
  if (!choices) return values;
  return values.map((value) => {
    const canonical = matchChoice(value, choices);
    if (canonical === undefined) {
      if (open) return value;
      problems.push({ code: 'bad-choice', name, value, choices: choices.map((choice) => choice.value) });
      return value;
    }
    return canonical;
  });
}

function parseArguments(command: ComposerCommand, tokens: string[]): { args: Record<string, string | string[]>; problems: ComposerCommandProblem[] } {
  const problems: ComposerCommandProblem[] = [];
  const args: Record<string, string | string[]> = {};
  const positionals: string[] = [];
  const flagValues = new Map<string, string[]>();
  const flags = command.flags ?? [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token.startsWith('--') || token.length === 2) {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    const name = (eq === -1 ? token.slice(2) : token.slice(2, eq)).toLowerCase();
    const flag = flags.find((candidate) => candidate.name === name);
    if (!flag) {
      problems.push({ code: 'unknown-flag', name });
      continue;
    }
    let value: string | undefined;
    if (eq !== -1) value = token.slice(eq + 1);
    else if (index + 1 < tokens.length && !tokens[index + 1]!.startsWith('--')) value = tokens[++index];
    const values = value === undefined ? [] : flag.multiple ? splitList(value) : [value];
    if (values.length === 0 || values.every((entry) => entry === '')) {
      problems.push({ code: 'missing-value', name });
      continue;
    }
    const seen = flagValues.get(name);
    if (seen && !flag.multiple) {
      problems.push({ code: 'duplicate-flag', name });
      continue;
    }
    flagValues.set(name, [...(seen ?? []), ...checkChoices(name, values, flag.choices, problems)]);
  }

  let cursor = 0;
  for (const arg of command.args) {
    if (arg.multiple) {
      const values = positionals.slice(cursor).flatMap(splitList);
      cursor = positionals.length;
      if (values.length > 0) args[arg.name] = checkChoices(arg.name, values, arg.choices, problems, arg.open);
      else if (arg.required) problems.push({ code: 'missing-arg', name: arg.name });
      continue;
    }
    const value = positionals[cursor];
    if (value === undefined) {
      if (arg.required) problems.push({ code: 'missing-arg', name: arg.name });
      continue;
    }
    cursor += 1;
    args[arg.name] = checkChoices(arg.name, [value], arg.choices, problems, arg.open)[0]!;
  }
  for (const extra of positionals.slice(cursor)) problems.push({ code: 'extra-arg', value: extra });

  for (const flag of flags) {
    const values = flagValues.get(flag.name);
    if (values) args[flag.name] = flag.multiple ? values : values[0]!;
    else if (flag.required) problems.push({ code: 'missing-flag', name: flag.name });
  }
  return { args, problems };
}

/** Classify a composer's input. Deterministic; never calls a model. */
export function parseComposerInput(text: string, registry: Pick<ComposerCommandRegistry, 'get'>): ComposerInput {
  const trimmed = text.trim();
  if (trimmed.startsWith('//')) return { kind: 'escaped', text: text.trimStart().slice(1) };
  const match = COMMAND.exec(trimmed);
  if (!match) return { kind: 'message' };

  const name = match[1]!;
  const command = registry.get(name);
  if (!command) return { kind: 'unknown', name };

  // Unavailable wins over a typo: the person learns it cannot run here before fixing its arguments.
  if (command.availability && !command.availability.ok) return { kind: 'unavailable', id: command.id, reason: command.availability.reason };
  const { args, problems } = parseArguments(command, tokenize(trimmed.slice(match[0].length)));
  if (problems.length > 0) return { kind: 'invalid', id: command.id, problems };
  return { kind: 'command', id: command.id, args, raw: trimmed };
}

/** English wording for a problem — the default a host overrides with its own catalog. */
export function describeComposerProblem(problem: ComposerCommandProblem): string {
  switch (problem.code) {
    case 'missing-arg': return `Missing <${problem.name}>`;
    case 'missing-flag': return `Missing --${problem.name}`;
    case 'missing-value': return `--${problem.name} needs a value`;
    case 'bad-choice': return `"${problem.value}" is not a valid ${problem.name} (one of: ${problem.choices.join(', ')})`;
    case 'unknown-flag': return `Unknown option --${problem.name}`;
    case 'duplicate-flag': return `--${problem.name} was given twice`;
    case 'extra-arg': return `Unexpected "${problem.value}"`;
  }
}
