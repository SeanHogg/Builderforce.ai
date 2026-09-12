/**
 * The newsletter event vocabulary — the ONE list of what can happen to a subscriber.
 *
 * Lives in the domain so every layer reads the same values: the Postgres enum
 * (`newsletterEventTypeEnum` in `infrastructure/database/schema/kernel.ts`) is
 * built FROM this list, and the admin route's request schema admits exactly these,
 * so a body can never carry an event type the column would refuse (which used to
 * surface as a 500 from the insert).
 */
export const NEWSLETTER_EVENT_TYPES = [
  'subscribed',
  'unsubscribed',
  'template_sent',
  'email_opened',
  'email_clicked',
] as const;

export type NewsletterEventType = (typeof NEWSLETTER_EVENT_TYPES)[number];
