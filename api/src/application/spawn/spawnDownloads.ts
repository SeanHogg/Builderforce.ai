/**
 * Where the Spawn installers are — so every download button on spawn.builderforce.ai
 * is one click to the file for the visitor's computer, not a trip through a list of
 * releases.
 *
 * Spawn's releases carry `spawn-v*` tags in the same repository as Synapse's
 * `desktop-v*` ones, so GitHub's `releases/latest` cannot name them; this picks the
 * newest published `spawn-v*` release and its installers. Cached for ten minutes:
 * a release is published a few times a month, and the GitHub read is rate-limited.
 */
import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { fetchPublicReleases, type PublicRelease } from '../../infrastructure/github/publicReleases';

const SPAWN_REPO = 'SeanHogg/Builderforce.ai';
const SPAWN_TAG_PREFIX = 'spawn-v';

export interface SpawnInstallers {
  /** `2026.10.1`, or null before the first release. */
  version: string | null;
  /** The release page — the fallback when an installer is missing. */
  releaseUrl: string | null;
  windows: string | null;
  macArm: string | null;
  macIntel: string | null;
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
 * The newest published Spawn release's installers. Tauri names them
 * `Spawn_<v>_x64-setup.exe` / `_x64_en-US.msi` and `Spawn_<v>_aarch64.dmg` /
 * `_x64.dmg`; the setup .exe is preferred because it installs per user, no admin.
 */
export function pickSpawnInstallers(releases: PublicRelease[]): SpawnInstallers {
  const release = releases.find((r) => r.tag.startsWith(SPAWN_TAG_PREFIX) && !r.draft && !r.prerelease);
  if (!release) return { version: null, releaseUrl: null, windows: null, macArm: null, macIntel: null };
  return {
    version: release.tag.slice(SPAWN_TAG_PREFIX.length),
    releaseUrl: release.url,
    windows: assetEndingWith(release, ['_x64-setup.exe', '_x64_en-US.msi']),
    macArm: assetEndingWith(release, ['_aarch64.dmg']),
    macIntel: assetEndingWith(release, ['_x64.dmg']),
  };
}

export async function spawnInstallers(env: Env, fetchFn: typeof fetch = fetch): Promise<SpawnInstallers> {
  return getOrSetCached(env, 'spawn:installers', async () => pickSpawnInstallers(await fetchPublicReleases(SPAWN_REPO, fetchFn)), {
    kvTtlSeconds: 600,
    l1TtlMs: 60_000,
  });
}
