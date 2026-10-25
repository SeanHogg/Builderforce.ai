/**
 * Composition — the step store port the sync message importer writes run steps through.
 * The ONE step store (`brain/chatStepStore.ts`) on the operational endpoint, resolved
 * from the push's committed core handle — never from its transaction, whose sibling
 * would resolve back to core.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { brainChatSteps } from '../../infrastructure/database/schema';
import { appendSteps, deleteStep, updateStep } from '../brain/chatStepStore';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';
import type { SyncStepStore } from './syncPorts';

export function syncStepStore(db: Db): SyncStepStore {
  return {
    async append(tenantId, chatId, step) {
      const [row] = await appendSteps(db, tenantId, chatId, [step]);
      return row?.id ?? null;
    },
    async chatOf(tenantId, stepId) {
      const [row] = await runTelemetryDatabase(db)
        .select({ chatId: brainChatSteps.chatId })
        .from(brainChatSteps)
        .where(and(eq(brainChatSteps.id, stepId), eq(brainChatSteps.tenantId, tenantId)))
        .limit(1);
      return row?.chatId ?? null;
    },
    update: (chatId, stepId, metadata) => updateStep(db, chatId, stepId, metadata),
    remove: (chatId, stepId) => deleteStep(db, chatId, stepId),
  };
}
