/**
 * One port per service in the ONE preview runtime (PRD 31 §W9 phase 5). Pure.
 *
 * - `allocatePorts`: the database's port and every explicitly declared, non-default
 *   port are held first; then each service on its kind's default (or a declared port
 *   that collided) takes the next free port, in blueprint order, up to `MAX_PORT`.
 * - `bindService`: a moved service's dev command is told its new port — ONLY where the
 *   command names it in a form we know (`--port N`, `--port=N`, `-p N`, `-pN`,
 *   `--bind`/`-b host:N`, `--urls`/`--url URL`, `php -S host:N`, a leading `PORT=N`),
 *   inside a `bfsh -c` script too; never another number (`--timeout 8000`). A command
 *   that names no port gets its server's flag (`RUNTIME_PORT_FLAGS`), else the service
 *   is declined: a service never runs bound to a port other than its spec's.
 * - `propagateMoves`: a service that depends on a moved one (and not on the one that
 *   kept the port) is given the environment with `localhost:OLD` moved to the new port.
 */
import { serviceDevPort, type AppService } from '@builderforce/creation-canvas-contract';
import type { ServiceSpec } from '@seanhogg/builderforce-webcontainers/app';
import { commandTokens, ENV_PREFIX, RUNTIME_PORT_FLAGS, shellSegments, tokenEnd, type CommandToken } from './commandLine';

export const MAX_PORT = 65535;

/** The port a service wants (declared, else its kind's default) and the one it gets (null: none left). */
export interface PortGrant {
  wanted: number;
  port: number | null;
}

/** The next port from `wanted` up that nothing holds yet (it is then held), or null past `MAX_PORT`. */
function freePort(wanted: number, held: Set<number>): number | null {
  for (let port = wanted; port <= MAX_PORT; port++) {
    if (!held.has(port)) {
      held.add(port);
      return port;
    }
  }
  return null;
}

/** Each service's port, by its index in `services`; undefined for a service with no port. */
export function allocatePorts(services: readonly AppService[], reserved: readonly number[]): Array<PortGrant | undefined> {
  const held = new Set(reserved);
  const wanted = services.map((service) => serviceDevPort(service));
  const grants: Array<PortGrant | undefined> = services.map(() => undefined);
  // First the ports a service declared on purpose: a default never pushes one of those off.
  services.forEach((service, index) => {
    const port = wanted[index];
    if (port === undefined || port === serviceDevPort({ kind: service.kind, ports: [] }) || held.has(port)) return;
    held.add(port);
    grants[index] = { wanted: port, port };
  });
  services.forEach((_, index) => {
    const port = wanted[index];
    if (port !== undefined && !grants[index]) grants[index] = { wanted: port, port: freePort(port, held) };
  });
  return grants;
}

/** Where a command names a port: the digits' place in the line. */
interface PortMention {
  start: number;
  length: number;
  port: number;
}

/** One command of a line: its name, its arguments and the ports it names. */
interface ParsedCommand {
  name: string;
  nameToken: CommandToken;
  args: CommandToken[];
  mentions: PortMention[];
}

/** `"8000"` written inside an unquoted word (`--port="8000"`): the value and its offset without the quotes. */
function unquoted(value: string, start: number): [string, number] {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted ? [quoted[2]!, start + 1] : [value, start];
}

const digitsAt = (raw: string, rawStart: number): PortMention[] => {
  const [value, start] = unquoted(raw, rawStart);
  return /^\d+$/.test(value) ? [{ start, length: value.length, port: Number(value) }] : [];
};

const hostPortAt = (raw: string, rawStart: number): PortMention[] => {
  const [value, start] = unquoted(raw, rawStart);
  const match = /^(.*):(\d+)$/.exec(value);
  return match ? [{ start: start + match[1]!.length + 1, length: match[2]!.length, port: Number(match[2]) }] : [];
};

const urlPortsAt = (raw: string, rawStart: number): PortMention[] => {
  const [value, start] = unquoted(raw, rawStart);
  return [...value.matchAll(/:\/\/[^/:;,\s]*:(\d+)/g)].map((match) => ({
    start: start + match.index + match[0].length - match[1]!.length, length: match[1]!.length, port: Number(match[1]),
  }));
};

/** The options whose value is a port (`--port 8000`), a bind (`-b 0.0.0.0:8000`) or URLs (`--urls http://…:8000`). */
const PORT_OPTIONS: Readonly<Record<string, (value: string, start: number) => PortMention[]>> = {
  '--port': digitsAt, '-p': digitsAt, '--bind': hostPortAt, '-b': hostPortAt, '--urls': urlPortsAt, '--url': urlPortsAt,
};
/** `php -S host:N`: PHP's built-in server takes its address positionally. */
const PHP_SERVER = '-S';
/** Commands that run another line (`bfsh -c "a && b"`): their script is read by the same rules. */
const SHELLS = new Set(['bfsh', 'sh', 'bash']);
/** Package runners whose next word is the command (`npx vite`). */
const PACKAGE_RUNNERS = new Set(['npx', 'bunx']);

const basename = (word: string): string => word.replace(/\\/g, '/').split('/').pop() ?? word;

function parseCommand(tokens: CommandToken[]): ParsedCommand | null {
  const mentions: PortMention[] = [];
  let at = 0;
  for (; tokens[at] && ENV_PREFIX.test(tokens[at]!.text); at++) {
    const assignment = tokens[at]!;
    if (assignment.text.startsWith('PORT=')) mentions.push(...digitsAt(assignment.text.slice(5), assignment.start + 5));
  }
  if (tokens[at] && PACKAGE_RUNNERS.has(basename(tokens[at]!.text))) at++;
  const nameToken = tokens[at];
  if (!nameToken) return null;
  const name = basename(nameToken.text);
  const args = tokens.slice(at + 1);
  for (let index = 0; index < args.length; index++) {
    const { text, start } = args[index]!;
    const equals = text.indexOf('=');
    const option = text.startsWith('--') && equals > 0 ? text.slice(0, equals) : text;
    const read = name === 'php' && option === PHP_SERVER ? hostPortAt : PORT_OPTIONS[option];
    const attached = /^-p(\d+)$/.exec(text);
    if (read && option !== text) mentions.push(...read(text.slice(equals + 1), start + equals + 1));
    else if (read && args[index + 1]) mentions.push(...read(args[index + 1]!.text, args[++index]!.start));
    else if (attached) mentions.push({ start: start + 2, length: attached[1]!.length, port: Number(attached[1]) });
  }
  return { name, nameToken, args, mentions };
}

/** The commands of `line` (placed at `base` in the whole line), a shell's `-c` script read as its own commands. */
function commandsIn(line: string, base: number): ParsedCommand[] {
  return shellSegments(line).flatMap((segment) => {
    const tokens = commandTokens(segment.text).map((token) => ({ ...token, start: token.start + segment.start + base }));
    const command = parseCommand(tokens);
    if (!command) return [];
    const script = command.args[1];
    if (SHELLS.has(command.name) && command.args[0]?.text === '-c' && script) return commandsIn(script.text, script.start);
    return [command];
  });
}

function portFlagOf(command: ParsedCommand): (typeof RUNTIME_PORT_FLAGS)[string] | undefined {
  const sub = command.args[0]?.text;
  return (sub !== undefined ? RUNTIME_PORT_FLAGS[`${command.name} ${sub}`] : undefined) ?? RUNTIME_PORT_FLAGS[command.name];
}

type Edit = { at: number; remove: number; text: string };

function applied(line: string, edits: Edit[]): string {
  return [...edits].sort((a, b) => b.at - a.at)
    .reduce((out, edit) => out.slice(0, edit.at) + edit.text + out.slice(edit.at + edit.remove), line);
}

/** The words that tell `command` its port, and where they go. */
function flagEdit(command: ParsedCommand, flag: (typeof RUNTIME_PORT_FLAGS)[string], port: number): Edit {
  const words = flag.words.map((word) => word.replace('{port}', String(port))).join(' ');
  if (flag.at === 'start') return { at: tokenEnd(command.nameToken), remove: 0, text: ` ${words}` };
  const passThrough = command.args.find((arg) => arg.text === '--' && !arg.quote);
  if (passThrough) return { at: passThrough.start, remove: 0, text: `${words} ` };
  return { at: tokenEnd(command.args.at(-1) ?? command.nameToken), remove: 0, text: ` ${words}` };
}

export type Rebind = { ok: true; line: string } | { ok: false; reason: string };

/** `line` moved off port `from` onto `to`, or why it cannot be. */
export function rebindCommand(line: string, from: number, to: number): Rebind {
  if (from === to) return { ok: true, line };
  const commands = commandsIn(line, 0);
  const mentions = commands.flatMap((command) => command.mentions);
  if (mentions.length > 0) {
    const ours = mentions.filter((mention) => mention.port === from);
    if (ours.length === 0) return { ok: false, reason: `it names port ${mentions[0]!.port}, not ${from}` };
    return { ok: true, line: applied(line, ours.map((mention) => ({ at: mention.start, remove: mention.length, text: String(to) }))) };
  }
  const flagged = commands.flatMap((command) => {
    const flag = portFlagOf(command);
    return flag ? [{ command, flag }] : [];
  });
  if (flagged.length === 0) return { ok: false, reason: 'it names no port, and its server takes no port flag we know' };
  if (flagged.length > 1) return { ok: false, reason: 'it names no port, and several of its commands could take one' };
  return { ok: true, line: applied(line, [flagEdit(flagged[0]!.command, flagged[0]!.flag, to)]) };
}

/** A service's dev command and port once its grant is applied — or why it is declined. */
export interface BoundService {
  line: string;
  port: number | undefined;
  move?: { from: number; to: number };
  declined?: string;
}

export function bindService(id: string, line: string, grant: PortGrant | undefined): BoundService {
  if (!grant) return { line, port: undefined };
  if (grant.port === null) return { line, port: grant.wanted, declined: `${id}: no free port from ${grant.wanted} up to ${MAX_PORT}.` };
  const rebound = rebindCommand(line, grant.wanted, grant.port);
  if (!rebound.ok) {
    return { line, port: grant.port, declined: `${id}: port ${grant.wanted} is taken, and its dev command cannot be moved to ${grant.port}: ${rebound.reason}.` };
  }
  return { line: rebound.line, port: grant.port, ...(grant.port !== grant.wanted ? { move: { from: grant.wanted, to: grant.port } } : {}) };
}

/** `env`'s values that name `localhost:from` (or `127.0.0.1`, `0.0.0.0`), with the port moved to `to`. */
export function movedEnv(env: Readonly<Record<string, string>>, from: number, to: number): Record<string, string> {
  const local = new RegExp(`(?<![\\w.-])(localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0):${from}(?!\\d)`, 'g');
  return Object.fromEntries(Object.entries(env).flatMap(([name, value]) => {
    const moved = value.replace(local, `$1:${to}`);
    return moved === value ? [] : [[name, moved]];
  }));
}

/**
 * Each service that depends on exactly one service moved off a port — and not on the
 * one that kept it — gets `env` with that port moved, as its own `env`. A reference
 * that could mean either is left as it is (the spec has no warnings channel to note it on).
 */
export function propagateMoves(
  services: ServiceSpec[], moves: ReadonlyArray<{ id: string; from: number; to: number }>, env: Readonly<Record<string, string>>,
): ServiceSpec[] {
  if (moves.length === 0 || Object.keys(env).length === 0) return services;
  return services.map((service) => {
    const deps = new Set(service.dependsOn ?? []);
    let own: Record<string, string> = {};
    for (const from of new Set(moves.map((move) => move.from))) {
      const moved = moves.filter((move) => move.from === from && deps.has(move.id));
      const keeperIsDep = services.some((other) => other.port === from && deps.has(other.id));
      if (moved.length !== 1 || keeperIsDep) continue;
      own = { ...own, ...movedEnv({ ...env, ...own }, from, moved[0]!.to) };
    }
    return Object.keys(own).length > 0 ? { ...service, env: { ...service.env, ...own } } : service;
  });
}
