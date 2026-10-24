/**
 * What every editor run leaves behind when it settles — ONE step for both editor
 * surfaces: the panel's host-owned runs (`brainRunHostPorts.ts` `sessionNote`) and the
 * native chat participant (`chatParticipant.ts`). Before this, only the panel wrote a
 * note and a code map; a run in the native chat view taught the next run nothing.
 *
 *   1. The dated `.builderforce/memory` note — awaited, because the next run's
 *      grounding (`recentActivitySection`) reads it.
 *   2. The project facts (code map + learned decisions), gated on the Memory switch in
 *      `commitRunKnowledgeIfAllowed` — NOT awaited: it is a network write (and a model
 *      completion when files changed), and a caller holding a chat until it returns
 *      would drop a turn sent in the meantime.
 */

import type * as vscode from "vscode";
import { rememberProjectFact } from "./bfApi";
import { resolveModelRoute, routeComplete } from "./modelRouting";
import { appendSessionNote } from "./sessionNotes";
import { commitRunKnowledgeIfAllowed, MEMORY_COMMIT_SYSTEM, type FinishedRun } from "./memoryCommit";
import type { RunNoteOptions } from "./brainRunHost";

export async function recordEditorRunEnd(
  secrets: vscode.SecretStorage,
  root: string,
  sessionKey: string,
  run: FinishedRun,
  opts: RunNoteOptions,
): Promise<void> {
  if (!root) return;
  await appendSessionNote(root, { sessionKey, activity: run.activity });
  // The project the run STARTED in, never the one selected when it settles: a run with
  // none had no project memory to recall from, so it writes none either.
  const projectId = opts.projectId;
  void commitRunKnowledgeIfAllowed(root, run, opts, async () =>
    projectId == null
      ? undefined
      : {
          complete: async (user) =>
            routeComplete(await resolveModelRoute(secrets), secrets, [
              { role: "system", content: MEMORY_COMMIT_SYSTEM },
              { role: "user", content: user },
            ]),
          remember: (key, content) => rememberProjectFact(secrets, projectId, key, content),
        },
  );
}
