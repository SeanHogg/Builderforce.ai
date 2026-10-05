/**
 * The playground's little Studio scenes — one per starter game, keyed by the
 * `id` of the matching entry in the `spawn.play.games` catalog. Geometry only:
 * every word the playground shows lives in the catalogs. Positions and sizes are
 * % of the scene box; colours are theme tokens, so both themes read.
 */
export interface SceneBlock {
  left: number;
  bottom: number;
  width: number;
  height: number;
  color: string;
  round?: boolean;
}

const GROUND: SceneBlock = { left: 0, bottom: 0, width: 100, height: 12, color: 'var(--success)' };

export const SPAWN_SCENES: Record<string, SceneBlock[]> = {
  obby: [
    GROUND,
    { left: 8, bottom: 12, width: 16, height: 8, color: 'var(--spawn-a)' },
    { left: 30, bottom: 24, width: 14, height: 8, color: 'var(--spawn-b)' },
    { left: 50, bottom: 36, width: 14, height: 8, color: 'var(--spawn-c)' },
    { left: 70, bottom: 48, width: 18, height: 8, color: 'var(--warning)' },
    { left: 80, bottom: 56, width: 3, height: 18, color: 'var(--text-primary)' },
    { left: 83, bottom: 66, width: 8, height: 7, color: 'var(--spawn-b)' },
  ],
  tycoon: [
    GROUND,
    { left: 6, bottom: 12, width: 30, height: 34, color: 'var(--spawn-a)' },
    { left: 12, bottom: 46, width: 18, height: 10, color: 'var(--spawn-b)' },
    { left: 36, bottom: 12, width: 50, height: 5, color: 'var(--text-secondary)' },
    { left: 46, bottom: 30, width: 8, height: 12, color: 'var(--spawn-c)' },
    { left: 66, bottom: 30, width: 8, height: 12, color: 'var(--spawn-c)' },
    { left: 48, bottom: 18, width: 4, height: 4, color: 'var(--warning)', round: true },
    { left: 68, bottom: 18, width: 4, height: 4, color: 'var(--warning)', round: true },
    { left: 86, bottom: 12, width: 10, height: 22, color: 'var(--success)' },
  ],
  racing: [
    GROUND,
    { left: 0, bottom: 12, width: 100, height: 16, color: 'var(--text-secondary)' },
    { left: 0, bottom: 19, width: 100, height: 2, color: 'var(--warning)' },
    { left: 10, bottom: 14, width: 12, height: 6, color: 'var(--spawn-b)' },
    { left: 34, bottom: 21, width: 12, height: 6, color: 'var(--spawn-c)' },
    { left: 84, bottom: 12, width: 3, height: 40, color: 'var(--text-primary)' },
    { left: 76, bottom: 46, width: 20, height: 8, color: 'var(--spawn-a)' },
    { left: 8, bottom: 34, width: 10, height: 18, color: 'var(--success)', round: true },
    { left: 52, bottom: 34, width: 10, height: 18, color: 'var(--success)', round: true },
  ],
  simulator: [
    GROUND,
    { left: 38, bottom: 12, width: 24, height: 34, color: 'var(--warning)', round: true },
    { left: 10, bottom: 12, width: 10, height: 10, color: 'var(--spawn-b)', round: true },
    { left: 22, bottom: 12, width: 8, height: 8, color: 'var(--spawn-c)', round: true },
    { left: 70, bottom: 12, width: 10, height: 10, color: 'var(--spawn-a)', round: true },
    { left: 82, bottom: 12, width: 8, height: 8, color: 'var(--spawn-b)', round: true },
    { left: 30, bottom: 58, width: 40, height: 8, color: 'var(--spawn-a)' },
    { left: 46, bottom: 66, width: 8, height: 8, color: 'var(--warning)', round: true },
  ],
  tower: [
    GROUND,
    { left: 0, bottom: 12, width: 100, height: 8, color: 'var(--text-secondary)' },
    { left: 10, bottom: 20, width: 7, height: 30, color: 'var(--spawn-a)' },
    { left: 40, bottom: 20, width: 7, height: 38, color: 'var(--spawn-c)' },
    { left: 70, bottom: 20, width: 7, height: 26, color: 'var(--spawn-b)' },
    { left: 24, bottom: 13, width: 5, height: 5, color: 'var(--error)', round: true },
    { left: 56, bottom: 13, width: 5, height: 5, color: 'var(--error)', round: true },
    { left: 86, bottom: 12, width: 12, height: 28, color: 'var(--warning)' },
  ],
};
