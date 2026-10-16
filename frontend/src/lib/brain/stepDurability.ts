/**
 * Durable Brain run steps for the web app.
 *
 * A run's step rows go through brain-embedded's step outbox; installed here, its queue
 * is kept in IndexedDB (one partition per chat), so steps a run could not save — the
 * tab went offline, the API redeployed — survive a reload. Every stored queue is
 * drained on load and again on `online`, straight to its chat's messages endpoint (no
 * run in that chat needed), under the event keys they were first sent with (no
 * duplicates).
 *
 * Sends pause while the browser reports offline and resume on `online`. Rows are SCOPED
 * to the tenant they were written in: switching workspace parks them rather than
 * replaying them into another tenant. Guests (no tenant) have their own scope.
 *
 * The IndexedDB wiring itself is brain-embedded's `installIndexedDbStepDurability` — the
 * same installer the Chrome extension (Rovr) uses — so this file only supplies what is
 * the web app's own: the window's connectivity events, the tenant, and the sender.
 *
 * Browser-only and idempotent: a no-op during SSR or where IndexedDB is unavailable
 * (private modes), where rows are still retried for the life of the tab.
 */

import { createOnlineSignal } from '@builderforce/write-outbox';
import { installIndexedDbStepDurability } from '@seanhogg/builderforce-brain-embedded';
import { getStoredTenant } from '../auth';
import { brain } from '../builderforceApi';

const DB_NAME = 'builderforce-outbox:brain-steps';

let installed = false;

/** The identity this tab sends as: its tenant, or the guest scope. */
function currentScope(): string {
  const tenant = getStoredTenant();
  return tenant ? `tenant:${tenant.id}` : 'guest';
}

export function installBrowserStepDurability(): void {
  if (installed || typeof window === 'undefined' || typeof indexedDB === 'undefined') return;
  installed = true;
  const online = createOnlineSignal(navigator.onLine);
  window.addEventListener('online', () => online.set(true));
  window.addEventListener('offline', () => online.set(false));
  installIndexedDbStepDurability({
    indexedDB,
    dbName: DB_NAME,
    online,
    scope: currentScope,
    // The tab holds ONE tenant token; the installer re-checks the scope before sending.
    sendRows: (chatId, rows) => brain.sendMessages(chatId, rows),
  });
}
