import type { CanvasObjectData as CreationNodeData } from '@/domains/canvas/domain/canvasObject';
import { uploadCanvasFile } from '@/lib/canvasMediaStore';
import { getStoredTenantToken } from '@/lib/auth';
import { bytesToBase64 } from '@/lib/base64Bytes';
import { withCreationDeliverable, type CreationDeliverable } from '@/lib/creationDeliverables';

/**
 * THE ONE export path of the creative editors (image, podcast, animation, comic, cad,
 * 3D model): a rendered file → where it can be fetched → a delivered record on the
 * object → the output fields the card reads. Each editor used to carry its own copy of
 * some of those steps, and the copies disagreed about which ones they did.
 *
 * Pure of React: the thin hook that adds busy/failed state and the browser download is
 * `components/creation-canvas/creative/useExportArtifact`.
 */

/** A blob as a `data:` URL — the form a guest's export is kept in. */
export async function blobDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
}

/** The most a guest's file may weigh to be kept inside the object as a data URL. */
export const INLINE_MAX_BYTES = 1_000_000;

/** Nobody is signed in: the one case where a file may be kept inline. */
export function isGuestSession(): boolean {
  return !getStoredTenantToken();
}

/** Why a file could not be put anywhere the object can keep it. */
export class CreationStorageError extends Error {
  constructor(readonly reason: 'upload-failed' | 'too-large') {
    super(`creation file not stored: ${reason}`);
    this.name = 'CreationStorageError';
  }
}

/**
 * THE ONE place a creative editor's file becomes a URL the object can hold: tenant
 * storage first. Only a real guest (nobody signed in, so no storage to upload to) keeps
 * the bytes inline, and only up to {@link INLINE_MAX_BYTES}; a signed-in person whose
 * upload failed gets a {@link CreationStorageError} instead of a megabyte of base64 in
 * the board JSON. `inline: true` skips the upload for small text files.
 */
export async function storeCreationFile(file: File, options: { inline?: boolean } = {}): Promise<string> {
  if (!options.inline) {
    const uploaded = await uploadCanvasFile(file);
    // The tenant-authenticated upload URL (`/api/brain/uploads/<key>`): a private export stays behind
    // authentication. Anything that renders it goes through `useAuthedMediaUrl` / `loadAuthedImage`.
    if (uploaded) return uploaded.url;
    if (!isGuestSession()) throw new CreationStorageError('upload-failed');
  }
  if (file.size > INLINE_MAX_BYTES) throw new CreationStorageError('too-large');
  return blobDataUrl(file);
}

export interface ExportedFile {
  blob: Blob;
  fileName: string;
  mimeType: string;
  /** The format's human name, e.g. `DXF`. */
  label: string;
  /** What the deliverable record says about it. */
  detail: string;
  /** The deliverable's action; `export` unless an editor has several kinds (`export-rss`). */
  action?: string;
  /** The card's picture of the result, when the format is not itself an image. */
  thumbnailUrl?: string | null;
  metadata?: Record<string, unknown>;
  /** Also make this file the object's output (`outputUrl` and friends). Editors whose base media must survive an export leave it off. */
  asOutput?: boolean;
  /** Keep the bytes inside the object (a data URL) instead of uploading them. */
  inline?: boolean;
  /** Further fields to write with the export; receives the URL the file ended up at. */
  extra?: (url: string) => Partial<CreationNodeData>;
}

/** The delivered record of an export — also what the Deliverables panel lists. */
function deliveredRecord(artifactKind: string, file: ExportedFile, url: string): CreationDeliverable {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    action: file.action ?? 'export',
    artifactKind,
    status: 'delivered',
    createdAt: now,
    completedAt: now,
    url,
    mimeType: file.mimeType,
    fileName: file.fileName,
    provider: 'native',
    validation: { status: 'passed', detail: file.detail },
    metadata: { edited: true, format: file.label, ...file.metadata },
  };
}

/**
 * Put the file where it can be fetched (see {@link storeCreationFile}) and return the
 * patch that records it. When it cannot be kept, `url` and `patch` are null: the caller
 * still downloads the blob, records nothing, and tells the person it was not saved.
 *
 * A data URL is stored once: if the output fields already carry it, the deliverable
 * leaves its own `url` off rather than repeating the bytes.
 */
export async function recordExport(data: CreationNodeData, artifactKind: string, file: ExportedFile): Promise<{ url: string; patch: Partial<CreationNodeData> } | { url: null; patch: null }> {
  let url: string;
  try {
    url = await storeCreationFile(new File([file.blob], file.fileName, { type: file.mimeType }), { inline: file.inline === true });
  } catch (error) {
    if (error instanceof CreationStorageError) return { url: null, patch: null };
    throw error;
  }
  const fields = {
    ...(file.asOutput ? { outputUrl: url, outputFormat: file.label, outputMimeType: file.mimeType, outputFileName: file.fileName } : {}),
    ...(file.thumbnailUrl ? { thumbnailUrl: file.thumbnailUrl } : {}),
    ...(file.extra?.(url) ?? {}),
  } as Partial<CreationNodeData>;
  const duplicated = url.startsWith('data:') && Object.values(fields).includes(url);
  const record = deliveredRecord(artifactKind, file, url);
  if (duplicated) { delete record.url; record.resourceRef = 'output'; }
  return { url, patch: { deliverables: withCreationDeliverable(data, record), ...fields } as Partial<CreationNodeData> };
}
