/**
 * Test support: make a chat's run live (or not) in the run store the way a run driver does - by mirroring a snapshot
 * (`applyRemoteRun`). Nothing in the product imports it.
 */
import { applyRemoteRun } from '../runStore/runControl';

export function mirrorRun(chat: number, running: boolean): void {
  applyRemoteRun(chat, {
    running,
    streamingText: '',
    error: '',
    errorAction: null,
    pendingConfirm: null,
    messagesEpoch: 0,
    appended: [],
    hasTrace: false,
    trace: [],
    activity: null,
    byoUnresolved: [],
    providerCap: [],
    turn: null,
  });
}
