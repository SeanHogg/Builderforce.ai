/**
 * Markdown auto-memory parsing + multi-path compaction.
 *
 * These exercise the two halves the Evermind importer gained: reading a Claude Code
 * auto-memory DIRECTORY (many files, one fact each) as the same learnable shape a JSON
 * snapshot yields, and compacting an import whose absorbed facts live in DIFFERENT files.
 * The single-file snapshot case is asserted alongside, because it is not a separate code
 * path any more — it is the one-path case of the general one, and it must still produce
 * exactly the old rewrite.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MEMORY_INDEX_FILE,
  compactMarkdownMemory,
  markdownEntry,
  parseFrontmatter,
  readMemoryDirectory,
} from './markdownMemory';
import { compactMemoryFiles, compactionTargets, readMemorySource } from './memoryImport';
import { STUB_PREFIX, isStub, parseSnapshotArray, snapshotEntryContent } from './memorySnapshot';

/** A real per-fact file, shaped exactly like the ones Claude Code writes. */
const FACT = `---
name: canvas-device-frame-rule
description: "Canvas previews frame the real published document at a real device width"
metadata:
  node_type: memory
  type: project
  originSessionId: ee00cb65-d4ba-44cc-80cc-8ddc4a3e6559
  modified: 2026-08-19T03:10:46.436Z
---

On the Creation Canvas, anything that PREVIEWS a document renders the real document
inside CanvasDeviceFrame, never a React re-drawing of it.

**Why:** a width cap hands the framed page the SMALLER width, so its own media queries
fire for the stage and Desktop renders the mobile collapse.
`;

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bf-md-memory-'));
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('markdown memory frontmatter', () => {
  it('reads top-level scalars and skips the nested metadata block', () => {
    const parsed = parseFrontmatter(FACT);
    expect(parsed.attrs.name).toBe('canvas-device-frame-rule');
    expect(parsed.attrs.description).toBe('Canvas previews frame the real published document at a real device width');
    // `metadata:` opens an indented block — its keys must NOT leak in as top-level attrs.
    expect(parsed.attrs.node_type).toBeUndefined();
    expect(parsed.attrs.originSessionId).toBeUndefined();
    expect(parsed.frontmatter.startsWith('---')).toBe(true);
    expect(parsed.body.startsWith('On the Creation Canvas')).toBe(true);
  });

  it('treats a file with no frontmatter as pure body', () => {
    const parsed = parseFrontmatter('just a fact, no frontmatter\n');
    expect(parsed.frontmatter).toBe('');
    expect(parsed.attrs).toEqual({});
    expect(parsed.body).toBe('just a fact, no frontmatter\n');
  });

  it('yields the learnable shape, keying on `name` and prompting with `description`', () => {
    const entry = markdownEntry(FACT, '/memory/canvas-device-frame-rule.md');
    expect(entry).not.toBeNull();
    expect(entry!.key).toBe('canvas-device-frame-rule');
    expect(entry!.prompt).toMatch(/^Canvas previews frame/);
    expect(entry!.text).toMatch(/^On the Creation Canvas/);
    expect(entry!.path).toBe('/memory/canvas-device-frame-rule.md');
  });

  it('falls back to the filename stem when there is no `name`', () => {
    const entry = markdownEntry('a fact with no frontmatter', '/memory/some-fact.md');
    expect(entry!.key).toBe('some-fact');
    expect(entry!.prompt).toBeUndefined();
  });

  it('skips an entry that is already a stub, so re-import is idempotent', () => {
    const stubbed = `---\nname: x\n---\n\n${STUB_PREFIX} v3] Already absorbed.\n`;
    expect(markdownEntry(stubbed, '/memory/x.md')).toBeNull();
  });
});

describe('markdown memory compaction', () => {
  it('replaces the body with a stub and keeps the frontmatter verbatim', () => {
    const result = compactMarkdownMemory(FACT, 4);
    expect(result).not.toBeNull();
    expect(result!.bytesSaved).toBeGreaterThan(0);
    const reparsed = parseFrontmatter(result!.next);
    expect(reparsed.attrs.name).toBe('canvas-device-frame-rule');
    expect(reparsed.attrs.description).toBeDefined();
    expect(isStub(reparsed.body)).toBe(true);
    expect(reparsed.body).toContain('v4]');
    expect(result!.next.length).toBeLessThan(FACT.length);
  });

  it('refuses to grow a fact that is already shorter than its stub', () => {
    expect(compactMarkdownMemory('---\nname: tiny\n---\n\nshort.\n', 1)).toBeNull();
  });
});

describe('reading a memory directory', () => {
  it('reads every per-fact file and never the MEMORY.md index', async () => {
    const memDir = path.join(dir, 'memory');
    await fs.mkdir(memDir, { recursive: true });
    await fs.writeFile(path.join(memDir, MEMORY_INDEX_FILE), '# Index\n\n- [a](a.md)\n- [b](b.md)\n');
    await fs.writeFile(path.join(memDir, 'a.md'), FACT.replace('canvas-device-frame-rule', 'fact-a'));
    await fs.writeFile(path.join(memDir, 'b.md'), FACT.replace('canvas-device-frame-rule', 'fact-b'));
    await fs.writeFile(path.join(memDir, 'notes.txt'), 'not a memory');

    const entries = await readMemoryDirectory(memDir);
    expect(entries.map((e) => e.key)).toEqual(['fact-a', 'fact-b']);
    expect(entries.every((e) => e.path.endsWith('.md'))).toBe(true);
  });

  it('accepts the directory, its MEMORY.md, or a single fact file', async () => {
    const memDir = path.join(dir, 'memory');
    const viaDir = await readMemorySource(memDir);
    const viaIndex = await readMemorySource(path.join(memDir, MEMORY_INDEX_FILE));
    const viaFact = await readMemorySource(path.join(memDir, 'a.md'));
    expect(viaDir!.map((e) => e.key)).toEqual(['fact-a', 'fact-b']);
    expect(viaIndex!.map((e) => e.key)).toEqual(['fact-a', 'fact-b']);
    expect(viaFact!.map((e) => e.key)).toEqual(['fact-a']);
  });

  it('reports an unrecognized file as null so the caller can explain', async () => {
    const junk = path.join(dir, 'junk.json');
    await fs.writeFile(junk, '{"not":"a snapshot"}');
    expect(await readMemorySource(junk)).toBeNull();
    expect(await readMemorySource(path.join(dir, 'does-not-exist.json'))).toBeNull();
  });

  it('reads a JSON snapshot into the SAME shape, every entry sharing the one path', async () => {
    const snap = path.join(dir, 'memory.json');
    await fs.writeFile(
      snap,
      JSON.stringify([
        { key: 'k1', content: 'A durable fact\nwith a second line.' },
        { key: 'k2', content: `${STUB_PREFIX} v1] already stubbed` },
        { key: 'k3', value: 'A legacy `value` entry\nwith more text.' },
      ]),
    );
    const entries = await readMemorySource(snap);
    expect(entries!.map((e) => e.key)).toEqual(['k1', 'k3']);
    expect(entries!.every((e) => e.path === snap)).toBe(true);
  });
});

describe('multi-path compaction', () => {
  it('groups a request by file, accepting both the legacy pair and the files array', () => {
    const targets = compactionTargets({
      path: '/a.json',
      absorbedKeys: ['k1'],
      files: [
        { path: '/a.json', absorbedKeys: ['k2'] },
        { path: '/b.md', absorbedKeys: ['k3'] },
        { path: undefined, absorbedKeys: ['ignored'] },
      ],
    });
    expect(targets).toHaveLength(2);
    expect([...targets.find((t) => t.path === '/a.json')!.keys].sort()).toEqual(['k1', 'k2']);
    expect([...targets.find((t) => t.path === '/b.md')!.keys]).toEqual(['k3']);
  });

  it('stubs absorbed facts across several markdown files at once, leaving the rest alone', async () => {
    const memDir = path.join(dir, 'multi');
    await fs.mkdir(memDir, { recursive: true });
    for (const key of ['one', 'two', 'three']) {
      await fs.writeFile(path.join(memDir, `${key}.md`), FACT.replace('canvas-device-frame-rule', key));
    }

    const outcome = await compactMemoryFiles(
      compactionTargets({
        files: [
          { path: path.join(memDir, 'one.md'), absorbedKeys: ['one'] },
          { path: path.join(memDir, 'three.md'), absorbedKeys: ['three'] },
        ],
      }),
      9,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.compacted).toBe(2);
    expect(outcome.bytesSaved).toBeGreaterThan(0);

    for (const key of ['one', 'three']) {
      const parsed = parseFrontmatter(await fs.readFile(path.join(memDir, `${key}.md`), 'utf8'));
      expect(isStub(parsed.body)).toBe(true);
      expect(parsed.attrs.name).toBe(key);
    }
    // Not absorbed — must be byte-for-byte untouched.
    expect(await fs.readFile(path.join(memDir, 'two.md'), 'utf8')).toBe(FACT.replace('canvas-device-frame-rule', 'two'));
  });

  it('still performs the single-file snapshot rewrite unchanged', async () => {
    const snap = path.join(dir, 'compact-me.json');
    const long = 'A durable fact.\n\nWith several more lines of body text that the stub replaces entirely.';
    await fs.writeFile(
      snap,
      JSON.stringify([
        { key: 'k1', content: long, tags: ['project'], importance: 0.9 },
        { key: 'k2', content: long },
      ]),
    );

    const outcome = await compactMemoryFiles(compactionTargets({ path: snap, absorbedKeys: ['k1'] }), 2);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.compacted).toBe(1);

    const rows = parseSnapshotArray(await fs.readFile(snap, 'utf8'))!;
    expect(snapshotEntryContent(rows[0])).toBe(`${STUB_PREFIX} v2] A durable fact.`);
    expect(rows[0].tags).toEqual(['project']);
    expect(rows[0].importance).toBe(0.9);
    expect(snapshotEntryContent(rows[1])).toBe(long);
  });

  it('compacts a snapshot and a markdown fact in ONE pass', async () => {
    const mixedDir = path.join(dir, 'mixed');
    await fs.mkdir(mixedDir, { recursive: true });
    const snap = path.join(mixedDir, 'memory.json');
    const md = path.join(mixedDir, 'fact.md');
    const long = 'Mixed source fact.\n\nAnd a good deal more body than the stub will keep.';
    await fs.writeFile(snap, JSON.stringify([{ key: 'from-json', content: long }]));
    await fs.writeFile(md, FACT.replace('canvas-device-frame-rule', 'from-markdown'));

    const outcome = await compactMemoryFiles(
      compactionTargets({
        files: [
          { path: snap, absorbedKeys: ['from-json'] },
          { path: md, absorbedKeys: ['from-markdown'] },
        ],
      }),
      5,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.compacted).toBe(2);
    expect(snapshotEntryContent(parseSnapshotArray(await fs.readFile(snap, 'utf8'))![0])).toContain('v5]');
    expect(isStub(parseFrontmatter(await fs.readFile(md, 'utf8')).body)).toBe(true);
  });

  it('writes NOTHING when any target is unreadable', async () => {
    const memDir = path.join(dir, 'abort');
    await fs.mkdir(memDir, { recursive: true });
    const good = path.join(memDir, 'good.md');
    await fs.writeFile(good, FACT.replace('canvas-device-frame-rule', 'good'));
    const before = await fs.readFile(good, 'utf8');

    const outcome = await compactMemoryFiles(
      compactionTargets({
        files: [
          { path: good, absorbedKeys: ['good'] },
          { path: path.join(memDir, 'missing.json'), absorbedKeys: ['nope'] },
        ],
      }),
      1,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.unreadable).toHaveLength(1);
    expect(await fs.readFile(good, 'utf8')).toBe(before);
  });

  it('reports zero rather than failing when nothing was absorbed', async () => {
    const outcome = await compactMemoryFiles(compactionTargets({ files: [] }), 1);
    expect(outcome).toEqual({ ok: true, compacted: 0, bytesSaved: 0 });
  });
});
