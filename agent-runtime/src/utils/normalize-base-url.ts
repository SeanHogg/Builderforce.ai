/** Strip trailing slashes from a base URL string. */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
