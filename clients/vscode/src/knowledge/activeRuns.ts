/**
 * "An agent or chat run is executing" for the background indexer. The source of truth is the brain run store every chat run
 * lives in (`@seanhogg/builderforce-brain-embedded`: one cell per chat, set when `startRun` begins and cleared when the loop
 * settles — a finish, an error and a Stop alike, so it cannot leak "active"). No second counter is kept.
 *
 * The person is idle while an agent works, so the idle gate alone would start the analysis mid-run: the indexer's `busy` port
 * reads {@link anyRunActive}, and a run that STARTS while a long pass runs stops that pass ({@link onRunStarted}).
 */

import { getGlobalRunState, subscribeRunStore } from "@seanhogg/builderforce-brain-embedded";

/** True while any chat or agent run is EXECUTING. A chat paused on a confirmation is not: one never answered must not keep the indexer busy for good. */
export function anyRunActive(): boolean {
  return getGlobalRunState().running.length > 0;
}

/** Calls `listener` each time the runs go from none active to some (a run STARTED). Returns the unsubscribe. */
export function onRunStarted(listener: () => void, subscribe: typeof subscribeRunStore = subscribeRunStore, active: () => boolean = anyRunActive): () => void {
  let was = active();
  return subscribe(() => {
    const now = active();
    if (now && !was) listener();
    was = now;
  });
}
