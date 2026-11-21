import { safeAttachmentUrl } from './safeUrl';
import type { AttachmentPreviewItem } from './types';

function clickLink(href: string, name: string, newTab = false): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.rel = 'noopener';
  if (newTab) a.target = '_blank';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Save `blob` under `name` — for a host port that fetched the bytes itself (an authorized read). */
export function saveBlobAs(blob: Blob, name: string): void {
  const objectUrl = URL.createObjectURL(blob);
  try {
    clickLink(objectUrl, name);
  } finally {
    // After the click has handed the blob to the browser's download.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

/** The picture's own `data:` copy, when it has one — the fallback when the original cannot be read. */
export function dataCopyOf(item: AttachmentPreviewItem): string | undefined {
  const copy = safeAttachmentUrl(item.previewUrl);
  return copy?.startsWith('data:') ? copy : undefined;
}

/**
 * The default download, for a browser host: the ORIGINAL file saved under its own name.
 * Only an attachment's own schemes are followed (`safeAttachmentUrl`). A `blob:` / `data:`
 * URL is saved directly; any other URL is fetched into a blob first, because `download` is
 * ignored across origins. When the read is refused, the picture's `data:` copy is saved
 * instead; failing that, a fetch the browser blocked (CORS) opens the link in a new tab, and
 * a refusal from the server fails with no message (the preview says "Download failed").
 * A host whose links need its own credential passes its own port instead.
 */
export async function browserDownload(item: AttachmentPreviewItem): Promise<boolean> {
  const url = safeAttachmentUrl(item.downloadUrl);
  if (!url) throw new Error('');
  if (url.startsWith('blob:') || url.startsWith('data:')) {
    clickLink(url, item.name);
    return true;
  }
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'include' });
  } catch {
    const copy = dataCopyOf(item);
    clickLink(copy ?? url, item.name, !copy);
    return true;
  }
  if (!res.ok) {
    const copy = dataCopyOf(item);
    if (!copy) throw new Error('');
    clickLink(copy, item.name);
    return true;
  }
  saveBlobAs(await res.blob(), item.name);
  return true;
}
