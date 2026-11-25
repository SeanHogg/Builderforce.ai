import { describe, expect, it } from 'vitest';
import { createComposerCommandRegistry, describeComposerProblem, parseComposerInput, type ComposerCommand } from './index';

const KITS = ['react-node', 'angular-node', 'vue-node'].map((value) => ({ value }));
const ENTRIES: ComposerCommand[] = [
  {
    id: 'starter-kit',
    syntax: '/starter-kit <kit> [--with <extra,...>]',
    args: [{ name: 'kit', required: true, choices: KITS }],
    flags: [{ name: 'with', multiple: true, choices: [{ value: 'postgres' }, { value: 'redis' }] }],
    example: '/starter-kit angular-node --with postgres',
  },
  {
    id: 'manifest',
    syntax: '/manifest init',
    args: [{ name: 'action', required: true, choices: [{ value: 'init' }] }],
    example: '/manifest init',
  },
  {
    id: 'launch',
    syntax: '/launch [environment]',
    args: [{ name: 'environment', required: false }],
    example: '/launch local',
    availability: { ok: false, reason: 'Needs the VS Code extension' },
  },
];
const labels = { describe: (id: string) => `desc:${id}` };
const registry = createComposerCommandRegistry(ENTRIES, labels);
const parse = (text: string) => parseComposerInput(text, registry);

describe('parseComposerInput', () => {
  it('treats paths, capitalised names and plain text as messages', () => {
    expect(parse('/api/users returns 500')).toEqual({ kind: 'message' });
    expect(parse('/Help')).toEqual({ kind: 'message' });
    expect(parse('/HELP')).toEqual({ kind: 'message' });
    expect(parse('hello /help')).toEqual({ kind: 'message' });
    expect(parse('/1st')).toEqual({ kind: 'message' });
  });

  it('leaves a lone `/` to the menu', () => {
    expect(parse('/')).toEqual({ kind: 'message' });
    expect(parse('  /  ')).toEqual({ kind: 'message' });
  });

  it('escapes a leading slash with `//`', () => {
    expect(parse('//help me')).toEqual({ kind: 'escaped', text: '/help me' });
    expect(parse('  //api/users')).toEqual({ kind: 'escaped', text: '/api/users' });
  });

  it('parses a command with a positional choice and a list flag', () => {
    expect(parse('/starter-kit angular-node --with postgres')).toEqual({
      kind: 'command',
      id: 'starter-kit',
      args: { kit: 'angular-node', with: ['postgres'] },
      raw: '/starter-kit angular-node --with postgres',
    });
    expect(parse('/starter-kit React-Node --with=postgres,Redis')).toMatchObject({
      kind: 'command',
      args: { kit: 'react-node', with: ['postgres', 'redis'] },
    });
    expect(parse('/starter-kit vue-node --with postgres --with redis')).toMatchObject({ args: { with: ['postgres', 'redis'] } });
  });

  it('parses bare `/help` and `/help <command>`', () => {
    expect(parse('/help')).toEqual({ kind: 'command', id: 'help', args: {}, raw: '/help' });
    expect(parse('/help starter-kit')).toMatchObject({ kind: 'command', args: { command: 'starter-kit' } });
  });

  it('reports a missing required argument', () => {
    expect(parse('/starter-kit')).toEqual({ kind: 'invalid', id: 'starter-kit', problems: [{ code: 'missing-arg', name: 'kit' }] });
  });

  it('validates choices, flags and extra values', () => {
    expect(parse('/starter-kit svelte-node')).toEqual({
      kind: 'invalid',
      id: 'starter-kit',
      problems: [{ code: 'bad-choice', name: 'kit', value: 'svelte-node', choices: ['react-node', 'angular-node', 'vue-node'] }],
    });
    expect(parse('/starter-kit react-node --with mongo')).toMatchObject({ kind: 'invalid', problems: [{ code: 'bad-choice', name: 'with', value: 'mongo' }] });
    expect(parse('/starter-kit react-node --colour blue')).toMatchObject({ kind: 'invalid', problems: [{ code: 'unknown-flag', name: 'colour' }, { code: 'extra-arg', value: 'blue' }] });
    expect(parse('/starter-kit react-node --with')).toMatchObject({ kind: 'invalid', problems: [{ code: 'missing-value', name: 'with' }] });
    expect(parse('/manifest init now')).toMatchObject({ kind: 'invalid', problems: [{ code: 'extra-arg', value: 'now' }] });
    expect(parse('/help nope')).toMatchObject({ kind: 'invalid', problems: [{ code: 'bad-choice', name: 'command', value: 'nope' }] });
  });

  it('lets an open argument take any value beside its choices, keeping quoted Windows paths intact', () => {
    const open = createComposerCommandRegistry([{
      id: 'launch',
      syntax: '/launch [environment | path]',
      args: [{ name: 'environment', required: false, open: true, choices: [{ value: 'staging' }] }],
      example: '/launch staging',
    }], labels);
    const run = (text: string) => parseComposerInput(text, open);
    expect(run('/launch STAGING')).toMatchObject({ kind: 'command', args: { environment: 'staging' } });
    expect(run('/launch "C:\\my docs\\a b.html"')).toMatchObject({ kind: 'command', args: { environment: 'C:\\my docs\\a b.html' } });
    expect(run('/launch C:\\code\\page.html')).toMatchObject({ kind: 'command', args: { environment: 'C:\\code\\page.html' } });
  });

  it('answers an unknown command as unknown, never a message', () => {
    expect(parse('/deploy prod')).toEqual({ kind: 'unknown', name: 'deploy' });
  });

  it('answers an unavailable command with its reason', () => {
    expect(parse('/launch local')).toEqual({ kind: 'unavailable', id: 'launch', reason: 'Needs the VS Code extension' });
  });

  it('words every problem in default English', () => {
    expect(describeComposerProblem({ code: 'missing-arg', name: 'kit' })).toBe('Missing <kit>');
    expect(describeComposerProblem({ code: 'bad-choice', name: 'kit', value: 'x', choices: ['a', 'b'] })).toContain('a, b');
  });
});

describe('createComposerCommandRegistry', () => {
  it('lists every registered entry plus the built-in help, help first', () => {
    const help = registry.help();
    expect(help.unknown).toBeUndefined();
    expect(help.entries.map((entry) => entry.id)).toEqual(['help', 'starter-kit', 'manifest', 'launch']);
    expect(help.entries.every((entry) => entry.description === `desc:${entry.id}`)).toBe(true);
    const helpEntry = help.entries[0]!;
    expect(helpEntry.args[0]!.choices!.map((choice) => choice.value)).toEqual(['starter-kit', 'manifest', 'launch']);
    expect(helpEntry.runnable).toBe(true);
  });

  it('renders one entry in full for `help(id)`', () => {
    const { entries } = registry.help('starter-kit');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'starter-kit',
      syntax: '/starter-kit <kit> [--with <extra,...>]',
      example: '/starter-kit angular-node --with postgres',
      availability: { ok: true },
      runnable: false,
      insertText: '/starter-kit ',
    });
    expect(registry.help('launch').entries[0]!.availability).toEqual({ ok: false, reason: 'Needs the VS Code extension' });
  });

  it('answers an unknown name with "no such command" and the full list', () => {
    const answer = registry.helpForUnknown('deploy');
    expect(answer.unknown).toBe('deploy');
    expect(answer.entries).toHaveLength(4);
    expect(registry.help('deploy')).toEqual(answer);
  });

  it('rejects a duplicate, a malformed id and a claim on `help`', () => {
    expect(() => createComposerCommandRegistry([ENTRIES[1]!, ENTRIES[1]!], labels)).toThrow(/twice/);
    expect(() => createComposerCommandRegistry([{ ...ENTRIES[1]!, id: 'Manifest' }], labels)).toThrow(/must match/);
    expect(() => createComposerCommandRegistry([{ ...ENTRIES[1]!, id: 'help' }], labels)).toThrow(/built in/);
  });

  it('get() resolves the built-in help and registered ids only', () => {
    expect(registry.get('help')?.syntax).toBe('/help [command]');
    expect(registry.get('manifest')?.id).toBe('manifest');
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.list()).toHaveLength(4);
  });
});
