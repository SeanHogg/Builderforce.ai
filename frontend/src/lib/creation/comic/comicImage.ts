import { resolveExportColor } from '../exportColors';
import { storeCreationFile } from '../exportArtifact';
/**
 * Turns a picked image file into panel art the comic can keep.
 *
 * The art is uploaded to tenant storage and the panel keeps only the https URL: a comic
 * round-trips through the board as JSON, and Brain patches cut strings at 40k characters,
 * so inline pixels would be corrupted by the first model edit. Only a real guest (nobody
 * signed in, so nowhere to upload) falls back to a small data URL — see `storeCreationFile`.
 * The image is scaled so its longer side is at most `maxSide` and re-encoded as JPEG.
 */
export const COMIC_IMAGE_MAX_SIDE = 1024;

export function scaledSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** `paper` (export palette role) is what a transparent picture is flattened onto before it becomes a JPEG. */
export async function scaleImageToJpeg(file: File, paper: string = resolveExportColor('paper'), maxSide = COMIC_IMAGE_MAX_SIDE): Promise<File> {
  if (!file.type.startsWith('image/')) throw new Error('not an image');
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2D context');
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('JPEG encoding failed');
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'panel'}.jpg`, { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}

/** The URL panel art is kept at: uploaded, or (guest only) inline. Throws `CreationStorageError` when it cannot be kept. */
export async function storeComicImage(file: File, paper?: string, maxSide = COMIC_IMAGE_MAX_SIDE): Promise<string> {
  return storeCreationFile(await scaleImageToJpeg(file, paper, maxSide));
}
