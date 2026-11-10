/**
 * The Heat camera's cell reading, pure (so the stage's Heat placement in the worker and the DOM `HeatGrid` share it):
 * how many cells are drawn at once and a cell's width from the size channel.
 */

import { NEUTRAL_SIZE } from './overlays';

/** The cell's width from the marker radius the overlay gives (5 + 2 x level, or the neutral size). */
export const cellWidth = (size: number): number => 64 + (size - NEUTRAL_SIZE) * 10;

/** Cells drawn at once; "N more" reveals the next page, so a huge repo never mounts thousands of buttons. */
export const HEAT_CELL_CAP = 200;
