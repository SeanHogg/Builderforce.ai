/**
 * An on-device TASK call as a usage row (PRD 42 · Part F). Every served utility call —
 * a fold's summary, a hand-off note — is one ordinary local row in the chat's run usage
 * ledger (`usageLedger.ts`): route `local`, role `utility`, the engine's model ref, the
 * call's estimated tokens. The ledger's own `local` rule prices what the chat's paid route
 * would have charged (the saving) and journals the row for sync; nothing new is stored or sent.
 *
 * A declined or replaced call books nothing here: no model ran on this device for it.
 */

import { formatLocalModelRef } from '@builderforce/local-inference';
import type { OnDeviceObserver } from '../onDevice/onDeviceTasks';
import type { RunUsageLedger } from './usageLedger';

/** The observer that books each SERVED task call into `ledger` under `run`'s chat. A failed write goes to `onError`. */
export function utilityUsageObserver(
  ledger: Pick<RunUsageLedger, 'record'>,
  run: { chatId: number; runKey: number; mode?: 'chat' | 'work' },
  onError: (error: unknown) => void = () => undefined,
): OnDeviceObserver {
  return (event) => {
    if (event.outcome !== 'served' || !event.engine || !event.model) return;
    void ledger.record({
      chatId: run.chatId,
      runKey: run.runKey,
      model: formatLocalModelRef(event.engine, event.model),
      route: 'local',
      role: 'utility',
      usage: { prompt: event.promptTokens ?? 0, completion: event.completionTokens ?? 0 },
      ...(run.mode ? { mode: run.mode } : {}),
    }).catch(onError);
  };
}
