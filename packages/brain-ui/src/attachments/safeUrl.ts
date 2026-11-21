/**
 * THE gate an attachment URL passes before it becomes an `href`, an `<img src>` or a fetch.
 * A turn's `[Attached: name](url)` link is message text another participant can write, and
 * the attachment preview uses it outside the markdown sanitizer — so only the schemes an
 * attachment really has are let through: `https:` / `http:` (an account link), `data:` (a
 * picture kept inline) and `blob:` (a file on this device). Anything else (`javascript:`,
 * `vbscript:`, `file:` …) is dropped. A relative URL resolves against the page, so it is
 * same-origin http(s) and kept.
 */
const ALLOWED = new Set(['https:', 'http:', 'data:', 'blob:']);

export function safeAttachmentUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  let protocol: string;
  try {
    protocol = new URL(trimmed, 'https://relative.invalid/').protocol.toLowerCase();
  } catch {
    return undefined;
  }
  return ALLOWED.has(protocol) ? trimmed : undefined;
}
