/**
 * Deploy notification fan-out — the single place that tells every opted-in
 * browser "a new app version shipped". Called by POST /api/push/notify-deploy,
 * which the frontend's cf-deploy step hits after a successful deploy.
 *
 * Sends a Web Push to each row in push_subscriptions, in bounded-concurrency
 * batches (a deploy fan-out must reach all subscribers, but we cap in-flight
 * requests rather than firing thousands at once). Subscriptions the push service
 * reports as gone (404/410) are deleted so the table self-prunes.
 */
import { inArray, sql } from 'drizzle-orm';
import { pushSubscriptions } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { sendWebPush, type VapidKeys } from './webPush';

const BATCH = 50; // max concurrent push sends

export interface DeployNotifyResult {
  total: number;
  sent: number;
  pruned: number;
}

export async function notifyDeployCompleted(
  db: Db,
  vapid: VapidKeys,
  args: { version: string; url?: string },
): Promise<DeployNotifyResult> {
  const subs = await db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions);

  const payload = {
    title: 'Builderforce updated',
    body: `Version ${args.version} is live. Reload to get the latest.`,
    tag: 'bf-deploy', // collapse: a newer deploy notification replaces an older one
    url: args.url ?? 'https://builderforce.ai',
    version: args.version,
  };

  const dead: number[] = [];
  const notified: number[] = [];

  for (let i = 0; i < subs.length; i += BATCH) {
    const slice = subs.slice(i, i + BATCH);
    const statuses = await Promise.all(
      slice.map((s) => sendWebPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload, vapid)),
    );
    statuses.forEach((status, j) => {
      const sub = slice[j];
      if (!sub) return;
      if (status === 404 || status === 410) dead.push(sub.id);
      else if (status >= 200 && status < 300) notified.push(sub.id);
    });
  }

  if (dead.length) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, dead));
  }
  if (notified.length) {
    await db
      .update(pushSubscriptions)
      .set({ lastNotifiedAt: sql`now()` })
      .where(inArray(pushSubscriptions.id, notified));
  }

  return { total: subs.length, sent: notified.length, pruned: dead.length };
}
