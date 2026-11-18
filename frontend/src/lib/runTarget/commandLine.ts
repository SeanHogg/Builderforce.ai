/**
 * A blueprint's command lines as the browser runtime reads them (PRD 31 §W9 phase 5):
 * the ONE tokenizer (`commandTokens` / `commandWords`), the shell's commands
 * (`shellSegments`), which runtime runs a command (`commandRuntime`), how a line is
 * spawned (`commandOf`), and how each runtime is told its port (`RUNTIME_PORT_FLAGS`).
 * Pure: no runtime, no network.
 */
import { isDotnetCommand, isPhpCommand, isPythonCommand, isRustCommand } from '@seanhogg/builderforce-webcontainers/app';

/**
 * The runtimes whose commands run as processes of the ONE preview runtime, each with
 * the runtime's OWN test of which commands are its (`isPythonCommand`: python, pip,
 * uvicorn, flask …; `isPhpCommand`: php, composer; `isDotnetCommand`: dotnet, `./app.cs`;
 * `isRustCommand`: cargo, wasmtime, a `.wasm` module). Anything else — a Node binary, the
 * shell (which hands these children to their runtimes itself) — is `node`.
 */
export const COMMAND_RUNTIMES: ReadonlyArray<{ runtime: string; owns: (command: string) => boolean }> = [
  { runtime: 'python', owns: isPythonCommand },
  { runtime: 'php', owns: isPhpCommand },
  { runtime: 'dotnet', owns: isDotnetCommand },
  { runtime: 'rust', owns: isRustCommand },
];

/**
 * How a dev server is told its port, by command (`name subcommand`, else `name`): the
 * words added to a command that names none, `{port}` standing for the port. `start`
 * puts them straight after the command (`php -S … script.php`); otherwise they go at
 * the end, before a `--`. A server not listed here cannot be moved to another port.
 */
export const RUNTIME_PORT_FLAGS: Readonly<Record<string, { words: readonly string[]; at?: 'start' }>> = {
  uvicorn: { words: ['--port', '{port}'] },
  fastapi: { words: ['--port', '{port}'] },
  'flask run': { words: ['--port', '{port}'] },
  vite: { words: ['--port', '{port}'] },
  next: { words: ['-p', '{port}'] },
  php: { words: ['-S', '0.0.0.0:{port}'], at: 'start' },
  'php artisan': { words: ['--port', '{port}'] },
  dotnet: { words: ['--urls', 'http://0.0.0.0:{port}'] },
};

export const PROCESS_RUNTIME = 'node';

/** The runtime a command runs on: the one that owns it, else Node. */
export function commandRuntime(command: string): string {
  return COMMAND_RUNTIMES.find((entry) => entry.owns(command))?.runtime ?? PROCESS_RUNTIME;
}

/** A word of a command line: its text, where that text starts in the line, and the quote around it. */
export interface CommandToken {
  text: string;
  start: number;
  quote: '' | '"' | "'";
}

/** Split a command line into words, honouring single and double quotes, each with its place in the line. */
export function commandTokens(line: string): CommandToken[] {
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  return [...line.matchAll(pattern)].map((match) => {
    const quote = match[1] !== undefined ? '"' : match[2] !== undefined ? "'" : '';
    return { text: match[1] ?? match[2] ?? match[3] ?? '', start: match.index + (quote ? 1 : 0), quote };
  });
}

/** Split a command line into words, honouring single and double quotes. */
export function commandWords(line: string): string[] {
  return commandTokens(line).map((token) => token.text);
}

/** Where a token's raw form (closing quote included) ends in its line. */
export const tokenEnd = (token: CommandToken): number => token.start + token.text.length + (token.quote ? 1 : 0);

/** Commands that run as they are; any other first word is a package binary, run through `npx`. */
const RUNNERS = new Set(['node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'bfsh']);

/** Shell operators (incl. a bare `&`), substitutions and redirects need the shell (`bfsh -c`). */
const SHELL_SYNTAX = /[&|;<>`$]/;
/** A leading `NAME=value` environment assignment needs the shell too. */
export const ENV_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** Where a shell line splits into commands (`&&`, `||`, `;`, `|`, `&`). */
const SHELL_SEPARATORS = /&&|\|\||[;|&]/g;

/**
 * The commands of a shell line, each with where it starts in the line — split at the
 * shell's separators outside quotes (a quoted `-c` script stays one word).
 */
export function shellSegments(line: string): Array<{ text: string; start: number }> {
  let unquoted = line;
  for (const token of commandTokens(line)) {
    if (token.quote) unquoted = unquoted.slice(0, token.start) + ' '.repeat(token.text.length) + unquoted.slice(token.start + token.text.length);
  }
  const segments: Array<{ text: string; start: number }> = [];
  let start = 0;
  for (const separator of unquoted.matchAll(SHELL_SEPARATORS)) {
    segments.push({ text: line.slice(start, separator.index), start });
    start = separator.index + separator[0].length;
  }
  segments.push({ text: line.slice(start), start });
  return segments;
}

/**
 * `npm run dev` → `npm ['run','dev']`; `vite --port 5173` → `npx ['vite',…]`; `a && b` → `bfsh ['-c','a && b']`.
 * A Python or PHP command (`uvicorn main:app`, `php -S …`, `composer install`) runs as it is, on its runtime.
 */
export function commandOf(line: string): { command: string; args: string[] } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (SHELL_SYNTAX.test(trimmed) || ENV_PREFIX.test(trimmed)) return { command: 'bfsh', args: ['-c', trimmed] };
  const [first, ...rest] = commandWords(trimmed);
  if (!first) return null;
  const asIs = RUNNERS.has(first) || commandRuntime(first) !== PROCESS_RUNTIME;
  return asIs ? { command: first, args: rest } : { command: 'npx', args: [first, ...rest] };
}
