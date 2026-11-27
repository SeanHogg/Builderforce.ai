/**
 * Where the Synapse desktop installers are. Today only the Spawn download button reads
 * this route: one click to the file for the visitor's computer. The Synapse links on the
 * site use GitHub's `releases/latest`.
 *
 * They come from SeanHogg/builderforce-inference with `v*` tags. That repo's releases
 * may carry only headless binaries (`bfi-*`, `bf-context-*`), so this picks the newest
 * published, non-prerelease `v*` release that actually contains an installer (drafts
 * and pre-releases never reach a visitor). Cached for ten minutes: a release is
 * published a few times a month, and the GitHub read is rate-limited.
 */
import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { fetchPublicReleases, type PublicRelease } from '../../infrastructure/github/publicReleases';

const SYNAPSE_REPO = 'SeanHogg/builderforce-inference';
const SYNAPSE_TAG_PREFIX = 'v';

const WINDOWS_SUFFIXES = ['_x64-setup.exe', '_x64_en-US.msi'];
const MAC_ARM_SUFFIXES = ['_aarch64.dmg'];
const MAC_INTEL_SUFFIXES = ['_x64.dmg'];
const LINUX_SUFFIXES = ['_amd64.deb'];
const INSTALLER_SUFFIXES = [...WINDOWS_SUFFIXES, ...MAC_ARM_SUFFIXES, ...MAC_INTEL_SUFFIXES, ...LINUX_SUFFIXES];

export interface DesktopInstallers {
  /** `2026.10.1`, or null before the first release. */
  version: string | null;
  /** The release page — the fallback when an installer is missing. */
  releaseUrl: string | null;
  windows: string | null;
  macArm: string | null;
  macIntel: string | null;
  /** The Debian/Ubuntu `_amd64.deb`, or null when the release has none. */
  linux: string | null;
}

/** The first asset whose name ends with one of `suffixes`, in the order given. */
function assetEndingWith(release: PublicRelease, suffixes: string[]): string | null {
  for (const suffix of suffixes) {
    const asset = release.assets.find((a) => a.name.endsWith(suffix));
    if (asset) return asset.url;
  }
  return null;
}

/**
 * The newest published release that carries installers. Tauri names them
 * `Synapse_<v>_x64-setup.exe` / `_x64_en-US.msi` and `Synapse_<v>_aarch64.dmg` /
 * `_x64.dmg`; the setup .exe is preferred because it installs per user, no admin.
 */
export function pickDesktopInstallers(releases: PublicRelease[]): DesktopInstallers {
  const release = releases.find(
    (r) =>
      r.tag.startsWith(SYNAPSE_TAG_PREFIX) &&
      !r.draft &&
      !r.prerelease &&
      assetEndingWith(r, INSTALLER_SUFFIXES) !== null,
  );
  if (!release) return { version: null, releaseUrl: null, windows: null, macArm: null, macIntel: null, linux: null };
  return {
    version: release.tag.slice(SYNAPSE_TAG_PREFIX.length),
    releaseUrl: release.url,
    windows: assetEndingWith(release, WINDOWS_SUFFIXES),
    macArm: assetEndingWith(release, MAC_ARM_SUFFIXES),
    macIntel: assetEndingWith(release, MAC_INTEL_SUFFIXES),
    linux: assetEndingWith(release, LINUX_SUFFIXES),
  };
}

export async function synapseInstallers(env: Env, fetchFn: typeof fetch = fetch): Promise<DesktopInstallers> {
  return getOrSetCached(env, 'desktop:installers', async () => pickDesktopInstallers(await fetchPublicReleases(SYNAPSE_REPO, fetchFn)), {
    kvTtlSeconds: 600,
    l1TtlMs: 60_000,
  });
}
