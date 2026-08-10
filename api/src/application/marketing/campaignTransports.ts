/**
 * How a campaign leaves the building.
 *
 * Before this, `runCampaignBatch` called `sendRawEmail` directly, so every
 * campaign went out through the PLATFORM's provider from a DNS-verified domain.
 * That is the right default and it stays the default — but it is not the only
 * way a tenant already sends mail, and forcing it had two real costs: a tenant
 * whose whole mail life is in Microsoft 365 had to publish a TXT record and send
 * from an unfamiliar pipe, and a tenant already paying Twilio for SendGrid had
 * to pay us for delivery a second time.
 *
 * Three transports, ONE interface. Each is a `(message) => Promise<void>` that
 * throws {@link TransportError} on failure; the send engine never branches on
 * which one it holds.
 *
 *   platform  the existing behaviour — Resend/SendPulse from a verified sender
 *   mailbox   the tenant's own connected Microsoft 365 / Gmail account
 *   sendgrid  the tenant's Twilio SendGrid connector connection
 *
 * `retryable` is the contract that matters. A campaign is a loop over thousands
 * of recipients, and the two failure modes need opposite handling: a revoked
 * mailbox grant or a bad API key will fail identically for every remaining
 * recipient, so the campaign must stop; a 429 or a 503 is the provider asking us
 * to come back, so only that recipient should fail and the sweep should pick it
 * up. Collapsing the two is how a campaign either burns its whole audience into
 * `failed` rows or retries a hopeless send forever.
 */

import { and, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { connectorConnections } from '../../infrastructure/database/schema';
import { sendRawEmail } from '../../infrastructure/email/EmailService';
import { executeConnectorAction, ConnectorCallError } from '../connectors/connectorRuntime';
import { sendFromMailbox } from '../mailbox/mailboxService';
import { htmlToPreviewText } from '../mailbox/mailboxProviders';

export const CAMPAIGN_TRANSPORTS = ['platform', 'mailbox', 'sendgrid'] as const;
export type CampaignTransport = typeof CAMPAIGN_TRANSPORTS[number];

export function isCampaignTransport(value: unknown): value is CampaignTransport {
  return typeof value === 'string' && (CAMPAIGN_TRANSPORTS as readonly string[]).includes(value);
}

/** The SendGrid connector key. Twilio's email product — the same connector the
 *  workflow builder and the agent tools already call. */
export const SENDGRID_CONNECTOR_KEY = 'sendgrid';

export interface TransportMessage {
  to: string;
  subject: string;
  html: string;
  /** RFC 2369 one-click unsubscribe target for this recipient. Bulk mail without
   *  it is filed as spam by Gmail and Outlook regardless of content. */
  unsubscribeUrl?: string;
}

export class TransportError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'TransportError';
  }
}

export interface CampaignSender {
  transport: CampaignTransport;
  /** The From: actually delivered — recorded on the campaign so the ledger
   *  describes what recipients saw, not what the config says today. */
  fromLabel: string;
  send(message: TransportMessage): Promise<void>;
}

/** Everything a transport needs to resolve itself, read straight off the campaign row. */
export interface TransportBinding {
  transport: string;
  senderIdentity: { fromEmail: string; fromName: string; status: string } | null;
  mailboxConnectionId: number | null;
  connectorConnectionId: string | null;
  fromName: string;
}

export type TransportResult =
  | { ok: true; sender: CampaignSender }
  | { ok: false; error: string };

/**
 * Resolve a campaign's binding into something that can send.
 *
 * Every precondition that protects a real person is checked HERE, once, before
 * the first message exists — the same discipline `startCampaign` already applies
 * to suppression and audience membership. A campaign that resolves is safe to
 * run to completion; one that does not never reaches a recipient at all.
 */
export async function resolveCampaignSender(
  db: Db,
  env: Env,
  tenantId: number,
  binding: TransportBinding,
): Promise<TransportResult> {
  const transport: CampaignTransport = isCampaignTransport(binding.transport) ? binding.transport : 'platform';

  if (transport === 'platform') {
    const sender = binding.senderIdentity;
    if (!sender) return { ok: false, error: 'Choose a verified From address before sending.' };
    if (sender.status !== 'verified') return { ok: false, error: 'That From address is not verified yet.' };
    const fromLabel = sender.fromName ? `${sender.fromName} <${sender.fromEmail}>` : sender.fromEmail;
    return {
      ok: true,
      sender: {
        transport,
        fromLabel,
        async send(message) {
          try {
            await sendRawEmail(env, { to: message.to, subject: message.subject, html: message.html, from: fromLabel });
          } catch (error) {
            // The platform provider's own failures are transient far more often
            // than not (quota, upstream 5xx), and a misconfiguration would have
            // thrown before the campaign ever started.
            throw new TransportError(error instanceof Error ? error.message : 'Send failed', true);
          }
        },
      },
    };
  }

  if (transport === 'mailbox') {
    const connectionId = binding.mailboxConnectionId;
    if (connectionId == null) return { ok: false, error: 'Choose a connected mailbox before sending.' };
    // Resolved lazily inside send() rather than pre-flighted here: the token is
    // refreshed per call anyway, and holding one across a multi-batch campaign
    // would guarantee an expiry mid-send.
    const { getMailboxConnection } = await import('../mailbox/mailboxService');
    const connection = await getMailboxConnection(db, tenantId, connectionId);
    if (!connection) return { ok: false, error: 'That mailbox is no longer connected.' };
    if (connection.status === 'revoked') {
      return { ok: false, error: `${connection.accountEmail} needs to be reconnected.` };
    }
    if (!connection.allowSending) {
      return { ok: false, error: `Sending is turned off for ${connection.accountEmail}.` };
    }
    const fromName = binding.fromName || connection.displayName;
    return {
      ok: true,
      sender: {
        transport,
        fromLabel: fromName ? `${fromName} <${connection.accountEmail}>` : connection.accountEmail,
        async send(message) {
          const result = await sendFromMailbox(db, env, tenantId, connectionId, {
            to: message.to,
            subject: message.subject,
            html: message.html,
            // Plain-text alternative derived from the same HTML, so the two
            // parts can never describe different offers.
            text: htmlToPreviewText(message.html),
            fromName,
            listUnsubscribeUrl: message.unsubscribeUrl,
          });
          if (!result.ok) throw new TransportError(result.error, result.retryable);
        },
      },
    };
  }

  // transport === 'sendgrid'
  const connectionId = binding.connectorConnectionId;
  if (!connectionId) return { ok: false, error: 'Choose a SendGrid connection before sending.' };
  const [connection] = await db
    .select({
      id: connectorConnections.id,
      name: connectorConnections.name,
      connectorKey: connectorConnections.connectorKey,
      enabled: connectorConnections.enabled,
    })
    .from(connectorConnections)
    .where(and(eq(connectorConnections.id, connectionId), eq(connectorConnections.tenantId, tenantId)))
    .limit(1);
  if (!connection) return { ok: false, error: 'That SendGrid connection no longer exists.' };
  if (connection.connectorKey !== SENDGRID_CONNECTOR_KEY) {
    return { ok: false, error: 'That connection is not a SendGrid connection.' };
  }
  if (!connection.enabled) return { ok: false, error: `The "${connection.name}" connection is disabled.` };

  // SendGrid will not send from an address it has not verified, and it is the
  // authority on that — so the From still comes from a verified sender identity.
  // The connector only replaces the DELIVERY pipe, not the identity model.
  const identity = binding.senderIdentity;
  if (!identity) return { ok: false, error: 'Choose the From address to send through SendGrid.' };
  if (identity.status !== 'verified') return { ok: false, error: 'That From address is not verified yet.' };
  const fromName = binding.fromName || identity.fromName;

  return {
    ok: true,
    sender: {
      transport,
      fromLabel: fromName ? `${fromName} <${identity.fromEmail}>` : identity.fromEmail,
      async send(message) {
        try {
          const result = await executeConnectorAction({
            db,
            env,
            tenantId,
            connectorKey: SENDGRID_CONNECTOR_KEY,
            actionKey: 'send_html_email',
            connectionId,
            actorKind: 'user',
            input: {
              to: message.to,
              from: identity.fromEmail,
              fromName,
              subject: message.subject,
              html: message.html,
              text: htmlToPreviewText(message.html),
            },
          });
          if (!result.ok) {
            // 429 and 5xx are SendGrid asking us to slow down; a 401/403 means
            // the API key is wrong and every remaining recipient would fail too.
            const retryable = result.status === 429 || result.status >= 500;
            throw new TransportError(
              `SendGrid returned ${result.status}${result.error ? `: ${result.error}` : ''}`,
              retryable,
            );
          }
        } catch (error) {
          if (error instanceof TransportError) throw error;
          // A ConnectorCallError is misconfiguration by construction (unknown
          // connector, missing credential, blocked URL) — never worth a retry.
          if (error instanceof ConnectorCallError) throw new TransportError(error.message, false);
          throw new TransportError(error instanceof Error ? error.message : 'SendGrid send failed', true);
        }
      },
    },
  };
}
