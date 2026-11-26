/**
 * The native-addon format check behind the bfi-node vendoring and the VSIX copy, pinned. Run with plain `node --test`.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertAddonMatchesPlatform, binaryFormatOf, expectedFormatFor } from './nativeAddonFormat.mjs';

const PE = [0x4d, 0x5a, 0x90, 0x00];
const ELF = [0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0];
const MACHO = [0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1];

test('formats are told apart by magic', () => {
  assert.equal(binaryFormatOf(Uint8Array.from(PE)), 'pe');
  assert.equal(binaryFormatOf(Uint8Array.from(ELF)), 'elf');
  assert.equal(binaryFormatOf(Uint8Array.from(MACHO)), 'macho');
  assert.equal(binaryFormatOf(Uint8Array.from([0xca, 0xfe, 0xba, 0xbe])), 'macho');
  assert.equal(binaryFormatOf(Uint8Array.from([1, 2, 3, 4])), 'unknown');
  assert.equal(binaryFormatOf(new Uint8Array(0)), 'unknown');
});

test('each platform expects its own format', () => {
  assert.equal(expectedFormatFor('win32'), 'pe');
  assert.equal(expectedFormatFor('darwin'), 'macho');
  assert.equal(expectedFormatFor('linux'), 'elf');
});

test('a mislabelled addon throws naming file, platform and format', () => {
  const dir = mkdtempSync(join(tmpdir(), 'addon-format-'));
  try {
    const elf = join(dir, 'bfi_node.win32-x64.node');
    writeFileSync(elf, Uint8Array.from(ELF));
    assert.throws(() => assertAddonMatchesPlatform(elf, 'win32'), /bfi_node\.win32-x64\.node.*win32.*elf/);
    assert.doesNotThrow(() => assertAddonMatchesPlatform(elf, 'linux'));
    const pe = join(dir, 'ok.node');
    writeFileSync(pe, Uint8Array.from(PE));
    assert.doesNotThrow(() => assertAddonMatchesPlatform(pe, 'win32'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
