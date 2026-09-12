import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { newsletterEvents, newsletterSubscribers, users } from '../../infrastructure/database/schema';

/**
 * The marketing newsletter's one write: subscribe or unsubscribe an address.
 *
 * It used to live inline in `authRoutes.ts`, under `/api/auth/newsletter/...`,
 * because that router was the nearest public Hono app — not because it has
 * anything to do with signing in. The URL is kept (marketing pages call it);
 * the code lives with the rest of marketing.
 *
 * Every write records a `newsletter_events` row, so the subscriber's history is
 * the audit trail rather than just the current status.
 */
export type NewsletterAction = 'subscribe' | 'unsubscribe';

export interface NewsletterSubscriptionInput {
  /** Already normalized (trimmed, lowercased) — the caller validated it. */
  email: string;
  action: NewsletterAction;
  source: string;
  firstName: string | null;
  lastName: string | null;
  reason: string | null;
}

export interface NewsletterSubscriptionResult {
  email: string;
  status: 'subscribed' | 'unsubscribed';
  subscribed: boolean;
}

export async function setNewsletterSubscription(
  db: Db,
  input: NewsletterSubscriptionInput,
): Promise<NewsletterSubscriptionResult> {
  const { email, action, source, firstName, lastName, reason } = input;

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  const [existing] = await db
    .select({ id: newsletterSubscribers.id })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.email, email))
    .limit(1);

  let subscriberId: number;

  if (action === 'subscribe') {
    if (existing) {
      const [updated] = await db
        .update(newsletterSubscribers)
        .set({
          userId: user?.id ?? null,
          firstName,
          lastName,
          source,
          status: 'subscribed',
          unsubscribedAt: null,
          unsubscribeReason: null,
          updatedAt: sql`now()`,
        })
        .where(eq(newsletterSubscribers.id, existing.id))
        .returning({ id: newsletterSubscribers.id });
      subscriberId = updated!.id;
    } else {
      const [created] = await db
        .insert(newsletterSubscribers)
        .values({ userId: user?.id ?? null, email, firstName, lastName, source, status: 'subscribed' })
        .returning({ id: newsletterSubscribers.id });
      subscriberId = created!.id;
    }

    await db.insert(newsletterEvents).values({
      subscriberId,
      eventType: 'subscribed',
      metadata: JSON.stringify({ source }),
    });
    return { email, status: 'subscribed', subscribed: true };
  }

  if (existing) {
    const [updated] = await db
      .update(newsletterSubscribers)
      .set({
        status: 'unsubscribed',
        unsubscribedAt: sql`now()`,
        unsubscribeReason: reason,
        updatedAt: sql`now()`,
      })
      .where(eq(newsletterSubscribers.id, existing.id))
      .returning({ id: newsletterSubscribers.id });
    subscriberId = updated!.id;
  } else {
    const [created] = await db
      .insert(newsletterSubscribers)
      .values({
        userId: user?.id ?? null,
        email,
        source,
        status: 'unsubscribed',
        unsubscribedAt: new Date(),
        unsubscribeReason: reason,
      })
      .returning({ id: newsletterSubscribers.id });
    subscriberId = created!.id;
  }

  await db.insert(newsletterEvents).values({
    subscriberId,
    eventType: 'unsubscribed',
    metadata: JSON.stringify({ source, reason }),
  });
  return { email, status: 'unsubscribed', subscribed: false };
}
