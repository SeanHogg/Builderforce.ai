/**
 * Agent Skills folders in the browser — reading what a person picked into the flat
 * `{ path, content, encoding? }` list every skill endpoint takes, and handing a folder
 * back as a .zip.
 *
 * Three ways in, one result: a picked DIRECTORY (`<input webkitdirectory>`, whose
 * files carry `webkitRelativePath`), a `.zip` of a skill folder, or a lone `SKILL.md`.
 * What makes the list a valid skill — paths, names, sizes — is decided afterwards by
 * `@builderforce/agent-skills`, the same package the server checks it with, so the
 * preview a person sees before importing is the verdict the server will reach.
 *
 * Text files (instructions, scripts, references) travel as text. A binary asset — by
 * the package's extension list, or because its bytes hold a NUL — travels as base64,
 * so an image or a font arrives byte-for-byte instead of mangled into a string.
 */

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { isBinarySkillPath, type SkillFile } from '@builderforce/agent-skills';
import { base64ToBytes, bytesToBase64 } from './base64Bytes';

/** A NUL byte in the first 8 KB is the usual tell of a binary file. */
function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

function toSkillFile(path: string, bytes: Uint8Array): SkillFile {
  return isBinarySkillPath(path) || looksBinary(bytes)
    ? { path, content: bytesToBase64(bytes), encoding: 'base64' }
    : { path, content: strFromU8(bytes) };
}

/** Read whatever was picked — a folder's files, one .zip, or a SKILL.md. */
export async function readPickedSkillFolder(picked: FileList | readonly File[]): Promise<SkillFile[]> {
  const list = Array.from(picked);
  if (list.length === 1 && /\.zip$/i.test(list[0]!.name)) {
    const entries = unzipSync(new Uint8Array(await list[0]!.arrayBuffer()));
    return Object.entries(entries).filter(([path]) => !path.endsWith('/')).map(([path, data]) => toSkillFile(path, data));
  }
  const files: SkillFile[] = [];
  for (const file of list) {
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    files.push(toSkillFile(path, new Uint8Array(await file.arrayBuffer())));
  }
  return files;
}

/** Download a skill folder as `<name>.zip`, its files under `<name>/` as agents expect. */
export function downloadSkillFolder(name: string, files: readonly SkillFile[]): void {
  const tree: Record<string, Uint8Array> = {};
  for (const f of files) tree[`${name}/${f.path}`] = f.encoding === 'base64' ? base64ToBytes(f.content) : strToU8(f.content);
  const zipped = zipSync(tree);
  const url = URL.createObjectURL(new Blob([zipped as BlobPart], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
