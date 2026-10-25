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
 *      would drop a turn sent in the meantime. Its model call is one more call of the
 *      chat's run, so it lands in the chat's usage ledger like every other (PRD 36).
 */

import type * as vscode from "vscode";
import { noteRunStep, withRunUsage, type LocalChatIdentity, type RunUsageLedger } from "@seanhogg/builderforce-brain-embedded";
import { rememberProjectFact } from "./bfApi";
import { getApiKey } from "./gateway";
import { resolveModelRoute, routeStream } from "./modelRouting";
import { appendSessionNote } from "./sessionNotes";
import { commitRunKnowledgeIfAllowed, MEMORY_COMMIT_SYSTEM, type FinishedRun } from "./memoryCommit";
import type { RunNoteOptions } from "./brainRunHost";

/** The chat whose usage ledger the run-end model call is recorded on. */
export interface RunEndUsage {
  ledger: RunUsageLedger;
  /** The LOCAL chat. */
  chatId: number;
  runKey: number;
  /** Names the call's server chat on the wire, as the run's own turns do (PRD 36). */
  identity: Pick<LocalChatIdentity, "serverIdFor">;
}

export async function recordEditorRunEnd(
  secrets: vscode.SecretStorage,
  root: string,
  sessionKey: string,
  run: FinishedRun,
  opts: RunNoteOptions,
  usage: RunEndUsage,
): Promise<void> {
  if (!root) return;
  await appendSessionNote(root, { sessionKey, activity: run.activity });
  // The project the run STARTED in, never the one selected when it settles: a run with
  // none had no project memory to recall from, so it writes none either.
  const projectId = opts.projectId;
  // The run's server chat rides every fact write (PRD 35 E8): its usage row is the fact's
  // origin cost, and the server applies the chat's own Memory gate to it.
  const chatMeta = async (): Promise<{ chatId?: number }> => {
    const id = await usage.identity.serverIdFor(usage.chatId).catch(() => undefined);
    return typeof id === "number" ? { chatId: id } : {};
  };
  // Memory off: one line on the run's trace saying so, so "0 facts written" reads as the
  // switch, not a fault. Said synchronously, before the host stops relaying the run.
  const note = (line: string): void => noteRunStep(usage.runKey, { label: "memory.commit_skipped", args: { reason: "memory-off" }, result: line });
  void commitRunKnowledgeIfAllowed(root, run, opts, async () =>
    projectId == null
      ? undefined
      : {
          complete: async (user) => {
            const [route, serverChatId] = await Promise.all([resolveModelRoute(secrets), usage.identity.serverIdFor(usage.chatId)]);
            const stream = withRunUsage(routeStream(route, await getApiKey(secrets)), usage.ledger, {
              chatId: usage.chatId,
              runKey: usage.runKey,
            });
            const result = await stream({
              messages: [
                { role: "system", content: MEMORY_COMMIT_SYSTEM },
                { role: "user", content: user },
              ],
              ...(route.model ? { model: route.model } : {}),
              ...(route.modelStrict !== undefined ? { modelStrict: route.modelStrict } : {}),
              ...(route.routingMode ? { routingMode: route.routingMode } : {}),
              ...(serverChatId !== undefined ? { metadata: { chatId: serverChatId } } : {}),
            });
            return result.text;
          },
          remember: async (key, content) => rememberProjectFact(secrets, projectId, key, content, await chatMeta()),
          rememberCodemap: async (key, content, meta) =>
            rememberProjectFact(secrets, projectId, key, content, { ...(await chatMeta()), fileAnchors: meta.fileAnchors }),
        },
    note,
  );
}
