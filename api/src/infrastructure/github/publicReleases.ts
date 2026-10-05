/**
 * The public releases of a public GitHub repository — the one read the download
 * pages need. Unauthenticated (60 requests an hour per IP), so every caller reads
 * through the cache; a failed read is an empty list, never a throw, because "no
 * installer yet" is a state the page already shows.
 */

export interface PublicReleaseAsset {
  name: string;
  url: string;
}

export interface PublicRelease {
  tag: string;
  url: string;
  draft: boolean;
  prerelease: boolean;
  assets: PublicReleaseAsset[];
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: Array<{ name: string; browser_download_url: string }>;
}

/** Newest first, as GitHub lists them. `repo` is `owner/name`. */
export async function fetchPublicReleases(repo: string, fetchFn: typeof fetch = fetch): Promise<PublicRelease[]> {
  const res = await fetchFn(`https://api.github.com/repos/${repo}/releases?per_page=30`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Builderforce-Downloads' },
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as GithubRelease[];
  return rows.map((r) => ({
    tag: r.tag_name,
    url: r.html_url,
    draft: r.draft,
    prerelease: r.prerelease,
    assets: r.assets.map((a) => ({ name: a.name, url: a.browser_download_url })),
  }));
}
