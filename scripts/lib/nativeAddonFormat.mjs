/**
 * Which executable format a native addon is, and whether it belongs to the platform its
 * file name claims. Windows shows a modal "Bad Image" dialog when asked to load an ELF
 * before Node's `require` can throw, so a mislabelled addon must fail the build, not the user.
 */
import { closeSync, openSync, readSync } from 'node:fs';

const MACHO_MAGICS = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);

/** @param {Uint8Array} bytes @returns {"pe" | "elf" | "macho" | "unknown"} */
export function binaryFormatOf(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return 'pe';
  if (bytes.length >= 4) {
    if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return 'elf';
    const magic = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    if (MACHO_MAGICS.has(magic)) return 'macho';
  }
  return 'unknown';
}

/** @param {string} platform a Node `process.platform` value @returns {"pe" | "elf" | "macho"} */
export function expectedFormatFor(platform) {
  if (platform === 'win32') return 'pe';
  if (platform === 'darwin') return 'macho';
  return 'elf';
}

/** Throws when `filePath` is not the executable format `platform` loads. */
export function assertAddonMatchesPlatform(filePath, platform) {
  const head = Buffer.alloc(8);
  const fd = openSync(filePath, 'r');
  let read;
  try {
    read = readSync(fd, head, 0, 8, 0);
  } finally {
    closeSync(fd);
  }
  const found = binaryFormatOf(head.subarray(0, read));
  const expected = expectedFormatFor(platform);
  if (found !== expected) {
    throw new Error(`${filePath} is labelled for ${platform} (expects ${expected}) but its bytes are ${found}.`);
  }
}
