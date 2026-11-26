/**
 * A tower's height from the size channel — THE one reading, shared by the SVG `TowerMark` and the stage's Map placement
 * (PRD 43 B1a rule 7: tilting the Map extrudes each station into its tower, height = the size channel). Pure, so the
 * worker can import it without React.
 */

const MIN_H = 14;
const STEP_H = 16;
/** The size channel with nothing to say reads the station's complexity level (the design's `level5('cx')`), else draws a middling tower, never a flat one. */
const NEUTRAL_LEVEL = 2;
const levelOf = (cx: number | undefined): number => (cx !== undefined && cx >= 1 && cx <= 5 ? cx : NEUTRAL_LEVEL);
/** `StationStyle.size` is `5 + level * 2` (1..5) when the channel is ready, else the neutral 8. */
const READY_LEVEL = (size: number): number | null => { const l = (size - 5) / 2; return Number.isInteger(l) && l >= 1 && l <= 5 ? l : null; };

/** `14 + level * 16`: 30px for the lowest level, 94px for the highest. `cx`: the station's complexity level, read only when the size channel has no reading. */
export const towerHeight = (size: number, cx?: number): number => MIN_H + (READY_LEVEL(size) ?? levelOf(cx)) * STEP_H;
