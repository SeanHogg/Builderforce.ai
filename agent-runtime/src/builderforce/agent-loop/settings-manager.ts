/**
 * Native settings manager — the pi-free replacement for `@mariozechner/pi-coding-agent`'s
 * `SettingsManager` (PI cutover, loop stage). The embedded runtime drives all behavior
 * from {@link BuilderForceAgentsConfig}, so only the compaction-budget surface that the
 * agent loop + `agent-settings.ts` actually read is reproduced here (defaults faithful to
 * pi 0.54: reserve 16384, keep-recent 20000); `applyOverrides` deep-merges at runtime.
 */

export interface CompactionSettings {
  reserveTokens: number;
  keepRecentTokens: number;
}

interface Settings {
  compaction?: Partial<CompactionSettings>;
}

const DEFAULT_RESERVE_TOKENS = 16_384;
const DEFAULT_KEEP_RECENT_TOKENS = 20_000;

export class SettingsManager {
  private settings: Settings;

  private constructor(settings: Settings) {
    this.settings = settings;
  }

  /** Faithful to pi's `SettingsManager.create(cwd, agentDir)` signature; the embedded
   *  runtime carries no on-disk pi settings file, so this starts from defaults. */
  static create(_cwd?: string, _agentDir?: string): SettingsManager {
    return new SettingsManager({});
  }

  applyOverrides(overrides: Settings): void {
    this.settings = {
      ...this.settings,
      ...overrides,
      compaction: { ...this.settings.compaction, ...overrides.compaction },
    };
  }

  getCompactionReserveTokens(): number {
    return this.settings.compaction?.reserveTokens ?? DEFAULT_RESERVE_TOKENS;
  }

  getCompactionKeepRecentTokens(): number {
    return this.settings.compaction?.keepRecentTokens ?? DEFAULT_KEEP_RECENT_TOKENS;
  }

  getCompactionSettings(): CompactionSettings {
    return {
      reserveTokens: this.getCompactionReserveTokens(),
      keepRecentTokens: this.getCompactionKeepRecentTokens(),
    };
  }
}
