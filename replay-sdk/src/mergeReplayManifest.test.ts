/**
 * `.github/scripts/merge-replay-manifest.mjs`: what `cdn-publish.sh` uploads is the NEW
 * manifest plus the live one's operator-set `pinned` and `channels` — a release must not
 * drop a rollback pin (PRD 33 §3.5). Run as the script itself, on fixture files.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(path.dirname(expect.getState().testPath!), '../../.github/scripts/merge-replay-manifest.mjs');

const NEW = { latest: { version: '2026.10.4', url: 'replay/r/recorder.bbbbbbbbbbbb.js', hash: 'bbbbbbbbbbbb' } };
const dirs: string[] = [];

interface Run { status: number | null; stderr: string; merged: Record<string, unknown> | null }

function merge(next: unknown, live: string, flags: string[] = []): Run {
  const dir = mkdtempSync(path.join(tmpdir(), 'merge-manifest-'));
  dirs.push(dir);
  const files = { next: path.join(dir, 'new.json'), live: path.join(dir, 'live.json'), out: path.join(dir, 'out.json') };
  writeFileSync(files.next, JSON.stringify(next));
  writeFileSync(files.live, live);
  const run = spawnSync(process.execPath, [SCRIPT, files.next, files.live, files.out, ...flags], { encoding: 'utf8' });
  return {
    status: run.status,
    stderr: run.stderr,
    merged: existsSync(files.out) ? (JSON.parse(readFileSync(files.out, 'utf8')) as Record<string, unknown>) : null,
  };
}

afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('merge-replay-manifest', () => {
  it('carries the live manifest\'s pinned and channels onto the new one', () => {
    const live = JSON.stringify({
      latest: { version: '2026.10.3' },
      pinned: { hash: 'aaaaaaaaaaaa' },
      channels: { beta: { hash: 'cccccccccccc' } },
    });
    const { merged } = merge(NEW, live);
    expect(merged!.latest).toEqual(NEW.latest);
    expect(merged!.pinned).toEqual({ hash: 'aaaaaaaaaaaa' });
    expect(merged!.channels).toEqual({ beta: { hash: 'cccccccccccc' } });
  });

  it('lets the new manifest\'s own pinned win and merges channels by name with the new entries winning', () => {
    const next = { ...NEW, pinned: { hash: 'dddddddddddd' }, channels: { beta: { hash: 'eeeeeeeeeeee' } } };
    const live = JSON.stringify({ pinned: { hash: 'aaaaaaaaaaaa' }, channels: { beta: { hash: 'cccccccccccc' }, canary: { hash: 'ffffffffffff' } } });
    const { merged } = merge(next, live);
    expect(merged!.pinned).toEqual({ hash: 'dddddddddddd' });
    expect(merged!.channels).toEqual({ beta: { hash: 'eeeeeeeeeeee' }, canary: { hash: 'ffffffffffff' } });
  });

  it('leaves the new manifest unchanged when there is no live one (a first publish)', () => {
    expect(merge(NEW, '').merged).toEqual(NEW);
  });

  it('refuses (exit 1, nothing written) when the live manifest is not a JSON object, so a pin is never silently dropped', () => {
    for (const body of ['<html>502</html>', 'null', '[]', '"text"', '42']) {
      const run = merge(NEW, body);
      expect(run.status, body).toBe(1);
      expect(run.merged, body).toBeNull();
      expect(run.stderr, body).toContain('refusing to publish over a possible pin');
    }
  });

  it('in a dry run only warns, and writes the new manifest unchanged', () => {
    const run = merge(NEW, '<html>502</html>', ['--dry-run']);
    expect(run.status).toBe(0);
    expect(run.stderr).toContain('dry run');
    expect(run.merged).toEqual(NEW);
  });
});
