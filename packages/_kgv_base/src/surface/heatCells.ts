/** The Heat placement's cell budget, pure (the worker's `placement/heat.ts` reads it). */

/** Cells placed at once; the rest are counted ("+N more"), so a huge repo never shows thousands of marks in one grid. */
export const HEAT_CELL_CAP = 200;
