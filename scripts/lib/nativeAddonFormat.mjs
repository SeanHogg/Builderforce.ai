/**
 * Which executable a native addon is — format AND CPU architecture — and whether it belongs
 * to the `<platform>-<arch>` its file name claims. Windows shows a modal "Bad Image" dialog
 * when asked to load a foreign binary, before Node's `require` can throw, so a mislabelled
 * addon must fail the build, not the user.
 *
 * This module also owns the addon naming (`bfi_node.<platform>-<arch>.node`): the file name
 * comes from `@seanhogg/bfi-node` itself, and `addonTagOf` is its one inverse.
 */
import { closeSync, openSync, readSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename } from 'node:path';

/** The package's own name builder — the single source of the naming. */
export const { addonFileName } = createRequire(import.meta.url)('../../packages/bfi-node/index.js');

const ADDON_NAME = /^bfi_node\.([a-z0-9]+)-([a-z0-9]+)\.node$/;
/** Enough of the file to cover every header read below (PE offsets, fat slice lists). */
const HEAD_BYTES = 4096;

const MACHO_THIN = { 0xfeedface: 'be', 0xfeedfacf: 'be', 0xcefaedfe: 'le', 0xcffaedfe: 'le' };
const MACHO_FAT = { 0xcafebabe: { be: true, entry: 20 }, 0xcafebabf: { be: true, entry: 32 }, 0xbebafeca: { be: false, entry: 20 }, 0xbfbafeca: { be: false, entry: 32 } };
const MACHO_CPU = { 0x01000007: 'x64', 0x0100000c: 'arm64' };
const ELF_MACHINE = { 62: 'x64', 183: 'arm64' };
const PE_MACHINE = { 0x8664: 'x64', 0xaa64: 'arm64' };

/** `{ platform, arch }` for `bfi_node.<platform>-<arch>.node` (a path is reduced to its name), else null. */
export function addonTagOf(fileName) {
  const match = ADDON_NAME.exec(basename(fileName));
  return match ? { platform: match[1], arch: match[2] } : null;
}

const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const u32be = (bytes) => (bytes.length >= 4 ? view(bytes).getUint32(0, false) : -1);

/** @param {Uint8Array} bytes @returns {"pe" | "elf" | "macho" | "unknown"} */
export function binaryFormatOf(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return 'pe';
  if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return 'elf';
  const magic = u32be(bytes);
  return magic in MACHO_THIN || magic in MACHO_FAT ? 'macho' : 'unknown';
}

/** @param {string} platform a Node `process.platform` value @returns {"pe" | "elf" | "macho"} */
export function expectedFormatFor(platform) {
  if (platform === 'win32') return 'pe';
  if (platform === 'darwin') return 'macho';
  return 'elf';
}

/** The architectures (`x64` / `arm64`; others are omitted) a binary's header says it runs on. */
export function archsOf(bytes) {
  const v = view(bytes);
  const found = [];
  const add = (arch) => arch && found.push(arch);
  switch (binaryFormatOf(bytes)) {
    case 'pe': {
      const at = bytes.length >= 0x40 ? v.getUint32(0x3c, true) : -1;
      if (at >= 0 && at + 6 <= bytes.length) add(PE_MACHINE[v.getUint16(at + 4, true)]);
      break;
    }
    case 'elf':
      if (bytes.length >= 20) add(ELF_MACHINE[v.getUint16(18, bytes[5] !== 2)]);
      break;
    case 'macho': {
      const magic = u32be(bytes);
      const fat = MACHO_FAT[magic];
      if (!fat) {
        if (bytes.length >= 8) add(MACHO_CPU[v.getUint32(4, MACHO_THIN[magic] === 'le')]);
        break;
      }
      if (bytes.length < 8) break;
      const count = Math.min(v.getUint32(4, !fat.be), Math.floor((bytes.length - 8) / fat.entry));
      for (let i = 0; i < count; i++) add(MACHO_CPU[v.getUint32(8 + i * fat.entry, !fat.be)]);
      break;
    }
  }
  return found;
}

function readHead(filePath) {
  const head = Buffer.alloc(HEAD_BYTES);
  const fd = openSync(filePath, 'r');
  try {
    return head.subarray(0, readSync(fd, head, 0, HEAD_BYTES, 0));
  } finally {
    closeSync(fd);
  }
}

/**
 * Throws when `filePath` is not the executable format `platform` loads, or (when `arch` is
 * a known one) does not contain code for that CPU.
 */
export function assertAddonMatchesPlatform(filePath, platform, arch) {
  const head = readHead(filePath);
  const format = binaryFormatOf(head);
  const expected = expectedFormatFor(platform);
  if (format !== expected) {
    throw new Error(`${filePath} is labelled for ${platform} (expects ${expected}) but its bytes are ${format}.`);
  }
  if (arch in { x64: 1, arm64: 1 }) {
    const archs = archsOf(head);
    if (!archs.includes(arch)) {
      throw new Error(`${filePath} is labelled for ${arch} but its ${format} header holds ${archs.join(', ') || 'no x64/arm64 code'}.`);
    }
  }
}

/** Checks one addon file against the `<platform>-<arch>` its own name claims. */
export function assertAddonFile(filePath) {
  const tag = addonTagOf(filePath);
  if (!tag) throw new Error(`${filePath} is not named bfi_node.<platform>-<arch>.node.`);
  assertAddonMatchesPlatform(filePath, tag.platform, tag.arch);
}
