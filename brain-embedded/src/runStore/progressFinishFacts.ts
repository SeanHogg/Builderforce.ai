/**
 * The progress guard's trace label and finish shape as plain data, so the diagnostics readers (`toolExposure.ts`, `routingByRole.ts`)
 * read the same facts the guard writes. The guard is the agent's (`@builderforce/agent-run` `policy/guards/forced`); these are its
 * constants, re-exported here so the readers keep one import for them.
 */

/** The trace label of a turn the progress guard forced (`args.forced`: 'hand_off' | 'change' | 'finish'), and the turns a finishing run
 *  may spend recording its remaining work as tickets, the finish turn itself included. */
export { FINISH_RECORD_TURNS, PROGRESS_FORCED_LABEL } from '@builderforce/agent-run';
