/**
 * BYO credential ALERTING — the single place a broken connected account gets both
 * recorded and COMMUNICATED.
 *
 * The store (`providerAuthAlerts`) answers "is this account broken?" for anyone who
 * looks. That is not the same as telling the owner, and the distinction is the whole
 * point of this module: an alert nobody looks at is exactly the failure mode the
 * Integrations page had — the state was knowable, and no human ever learned it.
 *
 * Three surfaces observe breakage, at three very different moments:
 *
 *   a live run's cascade  ──┐
 *   Settings ▸ Test button ─┼─► raiseProviderAuthAlert() ─► store  +  email admins
 *   the daily sweep       ──┘                                          (on TRANSITION)
 *
 * All three route through here so the answer to "when do I hear about it?" is the same
 * one — the first time it breaks, from whichever surface noticed first — instead of
 * depending on which code path happened to see the 401.
 *
 * TRANSITION, not state. The email fires only when a provider that had no live alert
 * gains one. Consequences worth being explicit about:
 *   • a run that keeps hitting the same dead credential mails once, not once per turn;
 *   • the daily sweep re-confirming yesterday's breakage mails nothing;
 *   • recovery is silent — the card simply goes green (and `clearProviderAuthAlert`
 *     re-arms the transition, so the NEXT break is reported again).
 *
 * Notification is strictly advisory: every failure here is swallowed. A workspace whose
 * admins cannot be emailed must still get the alert written, and a live request must
 * never fail because a mail did not send.
 */

import { buildDatabase } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getManagerEmails } from '../approval/approvalNotifier';
import { sendTransactionalEmail } from '../email/sendEmail';
import { sendByoCredentialAlertEmail, type ByoCredentialAlertRow } from '../../infrastructure/email/EmailService';
import {
  authAlertsFromFailovers,
  loadProviderAuthAlert,
  recordProviderAuthAlert,
  type AuthFailoverLike,
  type ProviderAuthAlert,
} from './providerAuthAlerts';

/** What one raised alert did — so a caller (the sweep) can tally without re-reading. */
export interface RaiseAlertOutcome {
  /** The provider had no live alert before this one: the owner has now been told. */
  transitioned: boolean;
  /** Admin addresses the notification went to (empty when nothing was sent). */
  notified: string[];
}

/**
 * Record an alert and, if this is the first time this provider has broken, email the
 * workspace's owners/managers. `detail` carries the upstream's own diagnostic into the
 * mail so the recipient reads the provider's words, not our paraphrase of them.
 */
export async function raiseProviderAuthAlert(
  env: Env,
  tenantId: number,
  alert: ProviderAuthAlert,
  detail = '',
): Promise<RaiseAlertOutcome> {
  const previous = await loadProviderAuthAlert(env, tenantId, alert.provider).catch(() => null);
  await recordProviderAuthAlert(env, tenantId, alert);
  if (previous) return { transitioned: false, notified: [] };
  const notified = await notifyBrokenProviders(env, tenantId, [{
    provider: alert.provider,
    reason: alert.reason,
    status: alert.status,
    vendor: alert.vendor,
    detail,
  }]);
  return { transitioned: true, notified };
}

/**
 * Raise every alert a live cascade's failovers imply — the DISPATCH-observed entry point.
 *
 * Called fire-and-forget from the gateway once a request has already been served, so its
 * cost is off the response path. `authAlertsFromFailovers` yields nothing for a cascade
 * with no owner-actionable failure, which is the overwhelming majority: the common path
 * is one array scan, no reads, no writes, no mail.
 */
export async function raiseProviderAuthAlertsFromFailovers(
  env: Env,
  tenantId: number,
  failovers: ReadonlyArray<AuthFailoverLike>,
): Promise<void> {
  const alerts = authAlertsFromFailovers(failovers);
  if (alerts.length === 0) return;
  // Sequential: the alerts are ≤1 per provider and this runs off the response path, while
  // parallel raises against the same tenant would each build their own DB handle.
  for (const alert of alerts) {
    const detail = failovers.find((f) => f.vendor === alert.vendor)?.detail ?? '';
    await raiseProviderAuthAlert(env, tenantId, alert, detail).catch((error) => { /* advisory */ 
      console.error('[suppressed-error] application/llm/byoCredentialAlerting.ts:96 raiseProviderAuthAlertsFromFailovers', { error });
    });
  }
}

/**
 * Email a workspace's owners/managers about providers that just broke. Exported so the
 * daily sweep can send ONE mail listing everything it found, rather than one per provider
 * — a workspace whose whole account set lapsed at once should get a single message.
 *
 * Returns the addresses mailed (empty if there are none, or if delivery is unconfigured).
 */
export async function notifyBrokenProviders(
  env: Env,
  tenantId: number,
  rows: readonly ByoCredentialAlertRow[],
): Promise<string[]> {
  if (rows.length === 0) return [];
  try {
    const db = buildDatabase(env);
    const recipients = await getManagerEmails(db, tenantId);
    if (recipients.length === 0) return [];
    const checkedAt = new Date().toISOString();
    await Promise.all(recipients.map((to) => sendTransactionalEmail(
      env,
      db,
      to,
      ({ locale }) => sendByoCredentialAlertEmail(env, to, [...rows], checkedAt, locale),
      // No request in scope on a cron tick, and the gateway path is fire-and-forget —
      // locale resolves from the recipient's stored preference either way.
    ).catch((error) => { /* one undeliverable address must not suppress the others */ 
      console.error('[suppressed-error] application/llm/byoCredentialAlerting.ts:118 notifyBrokenProviders', { error });
    })));
    return recipients;
  } catch {
    return []; // never let notification failure propagate into a request or a sweep
  }
}
