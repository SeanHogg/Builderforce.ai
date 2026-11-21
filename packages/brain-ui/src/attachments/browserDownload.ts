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

/**
 * The default download, for a browser host (the web app): the ORIGINAL file saved under
 * its own name. A `blob:` / `data:` URL is saved directly; any other URL is fetched (with
 * the session's cookies) into a blob first, because `download` is ignored across origins.
 * When that fetch is refused (CORS), the link opens in a new tab so the browser can save it.
 */
export async function browserDownload(item: AttachmentPreviewItem): Promise<boolean> {
  const url = item.downloadUrl;
  if (!url) throw new Error('no download URL');
  if (url.startsWith('blob:') || url.startsWith('data:')) {
    clickLink(url, item.name);
    return true;
  }
  let blob: Blob;
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    blob = await res.blob();
  } catch {
    clickLink(url, item.name, true);
    return true;
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    clickLink(objectUrl, item.name);
  } finally {
    // After the click has handed the blob to the browser's download.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
  return true;
}
