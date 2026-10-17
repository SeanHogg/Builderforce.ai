import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { zipFiles } from './zipFiles';

describe('zipFiles', () => {
  it('round-trips text and bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 255]);
    const members = unzipSync(zipFiles({ 'a.txt': 'héllo', 'dir/b.bin': bytes }));
    expect(strFromU8(members['a.txt']!)).toBe('héllo');
    expect(Array.from(members['dir/b.bin']!)).toEqual([0, 1, 2, 255]);
  });

  it('writes STORED members at level 0, so the names and bodies are readable raw', () => {
    const archive = zipFiles({ 'imsmanifest.xml': '<manifest/>' }, { level: 0 });
    expect(Array.from(archive.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // Compression method (offset 8 of the local header) is 0 — STORE.
    expect(archive[8]).toBe(0);
    expect(new TextDecoder().decode(archive)).toContain('<manifest/>');
  });
});
