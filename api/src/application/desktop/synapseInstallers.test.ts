import { describe, expect, it } from 'vitest';
import { pickDesktopInstallers } from './synapseInstallers';
import type { PublicRelease } from '../../infrastructure/github/publicReleases';

const release = (tag: string, names: string[], extra: Partial<PublicRelease> = {}): PublicRelease => ({
  tag,
  url: `https://github.com/o/r/releases/tag/${tag}`,
  draft: false,
  prerelease: false,
  assets: names.map((name) => ({ name, url: `https://dl/${tag}/${name}` })),
  ...extra,
});

describe('the Spawn installers', () => {
  it('picks the newest v* release and skips tags that are not versions', () => {
    const picked = pickDesktopInstallers([
      release('nightly', ['Spawn_nightly_x64-setup.exe']),
      release('v2026.10.2', ['Spawn_2026.10.2_x64-setup.exe', 'Spawn_2026.10.2_x64_en-US.msi', 'Spawn_2026.10.2_aarch64.dmg', 'Spawn_2026.10.2_x64.dmg']),
      release('v2026.10.1', ['Spawn_2026.10.1_x64-setup.exe']),
    ]);
    expect(picked.version).toBe('2026.10.2');
    expect(picked.windows).toBe('https://dl/v2026.10.2/Spawn_2026.10.2_x64-setup.exe');
    expect(picked.macArm).toBe('https://dl/v2026.10.2/Spawn_2026.10.2_aarch64.dmg');
    expect(picked.macIntel).toBe('https://dl/v2026.10.2/Spawn_2026.10.2_x64.dmg');
  });

  it('falls back to the .msi when there is no setup .exe', () => {
    expect(pickDesktopInstallers([release('v1', ['Spawn_1_x64_en-US.msi'])]).windows).toBe('https://dl/v1/Spawn_1_x64_en-US.msi');
  });

  it('ignores drafts and pre-releases', () => {
    const picked = pickDesktopInstallers([
      release('v3', ['Spawn_3_x64-setup.exe'], { draft: true }),
      release('v2', ['Spawn_2_x64-setup.exe'], { prerelease: true }),
    ]);
    expect(picked).toEqual({ version: null, releaseUrl: null, windows: null, macArm: null, macIntel: null });
  });

  it('reports a missing platform as null, not a wrong file', () => {
    const picked = pickDesktopInstallers([release('v1', ['Spawn_1_x64-setup.exe'])]);
    expect(picked.macArm).toBeNull();
    expect(picked.macIntel).toBeNull();
  });

  it('skips a newer release with only headless binaries for an older one that has an installer', () => {
    const picked = pickDesktopInstallers([
      release('v2026.11.2', ['bfi-x86_64-pc-windows-msvc.exe', 'bf-context-x86_64-pc-windows-msvc.exe']),
      release('v2026.11.1', ['Synapse_2026.11.1_x64-setup.exe']),
    ]);
    expect(picked.version).toBe('2026.11.1');
    expect(picked.windows).toBe('https://dl/v2026.11.1/Synapse_2026.11.1_x64-setup.exe');
  });
});
