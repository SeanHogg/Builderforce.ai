/**
 * The ONE "untested" line: line coverage under {@link UNTESTED_BELOW} reads as untested. The
 * "untested" question, the dashed transit segment, the stop tag's thin colour and the symbol facts
 * all draw it here, so they cannot disagree. Pure.
 */

export const UNTESTED_BELOW = 0.5;

/** Coverage was collected and is under the line. No reading (`undefined`) is never "untested". */
export const isUntested = (cov: number | undefined): boolean => cov !== undefined && cov < UNTESTED_BELOW;
