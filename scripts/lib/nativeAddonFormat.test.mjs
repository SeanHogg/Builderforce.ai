/**
 * The native-addon format check behind the bfi-node vendoring and the VSIX copy, pinned. Run with plain `node --test`.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { addonFileName, addonTagOf, archsOf, assertAddonFile, binaryFormatOf, expectedFormatFor } from './nativeAddonFormat.mjs';

/** A PE header: MZ, e_lfanew = 0x80, "PE\0\0", machine. */
function pe(machine) {
  const b = Buffer.alloc(0x100);
  b.write('MZ', 0, 'latin1');
  b.writeUInt32LE(0x80, 0x3c);
  b.write('PE\0\0', 0x80, 'latin1');
  b.writeUInt16LE(machine, 0x84);
  return b;
}
/** An ELF header with the given EI_DATA (1 = LE, 2 = BE) and e_machine. */
function elf(machine, data = 1) {
  const b = Buffer.alloc(64);
  b.set([0x7f, 0x45, 0x4c, 0x46, 2, data, 1], 0);
  if (data === 2) b.writeUInt16BE(machine, 18);
  else b.writeUInt16LE(machine, 18);
  return b;
}
/** A thin Mach-O: big-endian magic reads as FEEDFACF (BE) or CFFAEDFE (LE) per `le`. */
function macho(cputype, { le = true, wide = true } = {}) {
  const b = Buffer.alloc(32);
  const magic = wide ? 0xfeedfacf : 0xfeedface;
  if (le) {
    b.writeUInt32BE(wide ? 0xcffaedfe : 0xcefaedfe, 0);
    b.writeUInt32LE(cputype, 4);
  } else {
    b.writeUInt32BE(magic, 0);
    b.writeUInt32BE(cputype, 4);
  }
  return b;
}
/** A fat Mach-O listing `cputypes`; `le` is the byte-swapped file, `wide` the 64-bit fat_arch form. */
function fat(cputypes, { le = false, wide = false } = {}) {
  const entry = wide ? 32 : 20;
  const b = Buffer.alloc(8 + entry * cputypes.length);
  const write = le ? (v, at) => b.writeUInt32LE(v, at) : (v, at) => b.writeUInt32BE(v, at);
  b.writeUInt32BE(wide ? (le ? 0xbfbafeca : 0xcafebabf) : le ? 0xbebafeca : 0xcafebabe, 0);
  write(cputypes.length, 4);
  cputypes.forEach((t, i) => write(t, 8 + i * entry));
  return b;
}
const X64 = 0x01000007;
const ARM64 = 0x0100000c;

test('formats are told apart by magic', () => {
  assert.equal(binaryFormatOf(pe(0x8664)), 'pe');
  assert.equal(binaryFormatOf(elf(62)), 'elf');
  assert.equal(binaryFormatOf(macho(X64)), 'macho');
  assert.equal(binaryFormatOf(macho(7, { wide: false })), 'macho');
  assert.equal(binaryFormatOf(fat([X64])), 'macho');
  assert.equal(binaryFormatOf(fat([X64], { wide: true })), 'macho');
  assert.equal(binaryFormatOf(fat([X64], { le: true })), 'macho');
  assert.equal(binaryFormatOf(Uint8Array.from([1, 2, 3, 4])), 'unknown');
  assert.equal(binaryFormatOf(Uint8Array.from([0x7f, 0x45, 0x4c])), 'unknown');
  assert.equal(binaryFormatOf(new Uint8Array(0)), 'unknown');
});

test('each platform expects its own format', () => {
  assert.equal(expectedFormatFor('win32'), 'pe');
  assert.equal(expectedFormatFor('darwin'), 'macho');
  assert.equal(expectedFormatFor('linux'), 'elf');
});

test('architectures are read from each header', () => {
  assert.deepEqual(archsOf(pe(0x8664)), ['x64']);
  assert.deepEqual(archsOf(pe(0xaa64)), ['arm64']);
  assert.deepEqual(archsOf(elf(62)), ['x64']);
  assert.deepEqual(archsOf(elf(183)), ['arm64']);
  assert.deepEqual(archsOf(elf(183, 2)), ['arm64']);
  assert.deepEqual(archsOf(macho(X64)), ['x64']);
  assert.deepEqual(archsOf(macho(ARM64, { le: false })), ['arm64']);
  assert.deepEqual(archsOf(macho(7, { wide: false })), []);
  assert.deepEqual(archsOf(fat([X64, ARM64])), ['x64', 'arm64']);
  assert.deepEqual(archsOf(fat([ARM64], { le: true })), ['arm64']);
  assert.deepEqual(archsOf(fat([X64], { wide: true })), ['x64']);
  assert.deepEqual(archsOf(Uint8Array.from([0x4d, 0x5a])), []);
});

test('addon names parse to a platform-arch tag, and build from the package naming', () => {
  assert.deepEqual(addonTagOf('bfi_node.win32-x64.node'), { platform: 'win32', arch: 'x64' });
  assert.deepEqual(addonTagOf(join('some', 'dir', 'bfi_node.darwin-arm64.node')), { platform: 'darwin', arch: 'arm64' });
  assert.equal(addonTagOf('bfi_node.node'), null);
  assert.equal(addonTagOf('bfi_node.linux.node'), null);
  assert.equal(addonTagOf('other.win32-x64.node'), null);
  assert.equal(addonFileName('linux', 'x64'), 'bfi_node.linux-x64.node');
  assert.deepEqual(addonTagOf(addonFileName('darwin', 'arm64')), { platform: 'darwin', arch: 'arm64' });
});

test('assertAddonFile accepts matching binaries and rejects every mismatch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'addon-format-'));
  const check = (name, bytes) => {
    const file = join(dir, name);
    writeFileSync(file, bytes);
    return () => assertAddonFile(file);
  };
  try {
    assert.doesNotThrow(check('bfi_node.win32-x64.node', pe(0x8664)));
    assert.doesNotThrow(check('bfi_node.linux-arm64.node', elf(183)));
    assert.doesNotThrow(check('bfi_node.darwin-x64.node', macho(X64)));
    assert.doesNotThrow(check('bfi_node.darwin-arm64.node', fat([X64, ARM64], { le: true })));

    assert.throws(check('bfi_node.win32-x64.node', elf(62)), /bfi_node\.win32-x64\.node.*win32.*elf/);
    assert.throws(check('bfi_node.win32-arm64.node', pe(0x8664)), /arm64.*x64/);
    assert.throws(check('bfi_node.linux-x64.node', elf(183)), /x64.*arm64/);
    assert.throws(check('bfi_node.darwin-arm64.node', macho(X64)), /arm64.*x64/);
    assert.throws(check('bfi_node.darwin-arm64.node', fat([X64])), /arm64.*x64/);
    assert.throws(check('bfi_node.linux-x64.node', Uint8Array.from([0x7f, 0x45])), /unknown/);
    assert.throws(check('bfi_node.node', pe(0x8664)), /not named/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
