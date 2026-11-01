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
 * Four transports, ONE interface. Each is a `(message) => Promise<TransportReceipt>`
 * that throws {@link TransportError} on failure; the send engine never branches
 * on which one it holds.
 *
 *   platform  the existing behaviour — Resend/SendPulse from a verified sender
 *   mailbox   the tenant's own connected Microsoft 365 / Gmail account
 *   sendgrid  the tenant's Twilio SendGrid connector connection
 *   twilio    the tenant's Twilio connection, sending SMS (0940)
 *
 * ── WHY SMS IS A TRANSPORT AND NOT A SECOND ENGINE ──────────────────────────
 * Everything that makes a campaign safe is channel-independent: suppression, the
 * (campaign, recipient) uniqueness that makes a resumed send idempotent, the
 * attempt ceiling, the claim-before-send race guard. A parallel SMS engine would
 * have had to re-implement all four, and the ones it got wrong would be invisible
 * until a real audience was messaged twice. So the CHANNEL decides which address
 * and which body a recipient gets, and the transport decides which pipe carries
 * it — and the loop in `runCampaignBatch` is unchanged either way.
 *
 * What is genuinely different is REPORTING. An email's engagement is an open
 * pixel and a click rewrite, neither of which exists in a text message; a
 * carrier reports delivery back asynchronously instead. That is why an SMS send
 * returns an `externalId` and gets its status from a webhook, rather than
 * pretending a pixel could tell us.
 *
 * `retryable` is the contract that matters. A campaign is a loop over thousands
 * of recipients, and the two failure modes need opposite handling: a revoked
 * mailbox grant or a bad API key will fail identically for every remaining
 * recipient, so the campaign must stop; a 429 or a 503 is the provider asking us
 * to come back, so only that recipient should fail and the sweep should pick it
 * up. Collapsing the two is how a campaign either burns its whole audience into
 * `failed` rows or retries a hopeless send forever.
 *
 * A terminal failure still has two owners, and `scope` says which: a bad number is
 * the RECIPIENT's (the batch carries on), a revoked credential is the SENDER's (the
 * campaign stops). Treating every terminal failure as the sender's is how one
 * un-textable number stalls an entire audience.
 *
 * Two classifications keep that honest. A provider that is not serving us (status 0: the connector
 * runtime reports a fetch failure or its timeout as a result, not a throw; or a 429 or a 5xx) is
 * RETRYABLE, never a terminal write-off, and flagged `providerUnavailable` so the batch stops
 * instead of spending an attempt, or a timeout, on every remaining row.
 * And an HTTP 400 is not always the recipient's: Twilio's own error codes for an unusable From
 * ({@link TWILIO_SENDER_ERROR_CODES}) are the SENDER's, so a dead number cannot end a campaign
 * as `sent` with nothing delivered.
 */

import { and, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { connectorConnections } from '../../infrastructure/database/schema';
import { EmailDeliveryError, sendRawEmail } from '../../infrastructure/email/EmailService';
import { executeConnectorAction, ConnectorCallError } from '../connectors/connectorRuntime';
import { sendFromMailbox } from '../mailbox/mailboxService';
import { htmlToPreviewText } from '../mailbox/mailboxProviders';
import { isE164 } from '../shared/contactAddress';
import { isRetryableProviderStatus } from '../shared/campaignDelivery';

export const CAMPAIGN_TRANSPORTS = ['platform', 'mailbox', 'sendgrid', 'twilio'] as const;
export type CampaignTransport = typeof CAMPAIGN_TRANSPORTS[number];

export function isCampaignTransport(value: unknown): value is CampaignTransport {
  return typeof value === 'string' && (CAMPAIGN_TRANSPORTS as readonly string[]).includes(value);
}

/** What kind of message a campaign sends. */
export const CAMPAIGN_CHANNELS = ['email', 'sms'] as const;
export type CampaignChannel = typeof CAMPAIGN_CHANNELS[number];

export function isCampaignChannel(value: unknown): value is CampaignChannel {
  return typeof value === 'string' && (CAMPAIGN_CHANNELS as readonly string[]).includes(value);
}

/**
 * Which transports each channel can actually use — declared as DATA so the
 * composer, the REST route, the MCP tool and the send engine all read one
 * answer. A cross-product check written per caller is how "it let me pick
 * SendGrid for an SMS" happens in one place and not the others.
 */
export const TRANSPORTS_BY_CHANNEL: Readonly<Record<CampaignChannel, readonly CampaignTransport[]>> = {
  email: ['platform', 'mailbox', 'sendgrid'],
  sms: ['twilio'],
};

/** The transport a channel uses when the caller does not name one. */
export const DEFAULT_TRANSPORT: Readonly<Record<CampaignChannel, CampaignTransport>> = {
  email: 'platform',
  sms: 'twilio',
};

export function transportSuitsChannel(channel: CampaignChannel, transport: CampaignTransport): boolean {
  return TRANSPORTS_BY_CHANNEL[channel].includes(transport);
}

/** The SendGrid connector key. Twilio's email product — the same connector the
 *  workflow builder and the agent tools already call. */
export const SENDGRID_CONNECTOR_KEY = 'sendgrid';

/** The Twilio connector key — the same manifest whose `send_sms` action agents
 *  and workflows already call. A campaign is not a second door to Twilio; it is
 *  the same one, with an audience in front of it. */
export const TWILIO_CONNECTOR_KEY = 'twilio';

export interface TransportMessage {
  to: string;
  subject: string;
  html: string;
  /** The plain-text body. For SMS it IS the message; for email it is the
   *  text/plain alternative, derived from the same HTML so the two parts can
   *  never describe different offers. */
  text?: string;
  /** RFC 2369 one-click unsubscribe target for this recipient. Bulk mail without
   *  it is filed as spam by Gmail and Outlook regardless of content. */
  unsubscribeUrl?: string;
  /** Where the carrier should report this message's delivery state. SMS only —
   *  email has no equivalent, which is why an open pixel exists at all. */
  statusCallbackUrl?: string;
}

/**
 * What a transport hands back.
 *
 * `externalId` is the provider's own id for the message. Email transports have
 * no use for one — the tracking model is a pixel and a rewritten link — but an
 * SMS's delivery state arrives LATER, on a webhook, and this is the id that
 * conversation is conducted in.
 */
export interface TransportReceipt {
  externalId?: string;
}

/**
 * WHOSE failure a {@link TransportError} is — the question `retryable` cannot answer.
 *
 *   recipient  this message only: a number Twilio refuses, an address the provider rejects, a
 *              recipient with no number. The next recipient is unaffected, so the batch goes on.
 *   sender     the pipe itself: a revoked grant, a wrong API key, a deleted or disabled
 *              connection. Every remaining recipient fails identically, so the campaign stops.
 *
 * `scope` is only ever CONSULTED for a terminal (non-retryable) failure: a retryable one is
 * requeued and bounded by the attempt ceiling whichever side it is on. It is required, not
 * defaulted, so a new throw site has to decide.
 */
export type TransportErrorScope = 'recipient' | 'sender';

export class TransportError extends Error {
  /**
   * `providerUnavailable`: the PROVIDER is not serving us, as opposed to this message being
   * refused: it never answered (a network error, the call's timeout), or answered 429 or 5xx. The
   * batch stops at the first one, because the next 24 would meet the same throttle or outage and
   * each would cost an attempt (and, for a silent provider, a full timeout), and requeues what it
   * had claimed. A per-recipient bounce ("mailbox full") is NOT this: it says nothing about the next.
   */
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly scope: TransportErrorScope,
    readonly providerUnavailable: boolean = false,
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

/**
 * Twilio error codes that mean the FROM is unusable, so every message from it fails the same way
 * even though Twilio answers HTTP 400 (which {@link providerStatusScope} reads as one recipient's).
 * Data, so a code is added here and nowhere else.
 *
 *   21212  invalid `From` number
 *   21603  no `From` (or messaging service) supplied
 *   21606  `From` is not a valid, SMS-capable number on this account
 *   21659  `From` is not a Twilio number
 */
export const TWILIO_SENDER_ERROR_CODES: readonly string[] = ['21212', '21603', '21606', '21659'];

/** The provider's own `code` off a Twilio error body (`{ code, message, more_info }`), as a string. */
export function twilioErrorCode(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === 'number' || typeof code === 'string' ? String(code) : null;
}

/** Whose failure a Twilio HTTP failure is: the sender code list first, then the status. */
export function twilioFailureScope(status: number | null | undefined, data: unknown): TransportErrorScope {
  const code = twilioErrorCode(data);
  if (code !== null && TWILIO_SENDER_ERROR_CODES.includes(code)) return 'sender';
  return providerStatusScope(status);
}

/**
 * Scope of an HTTP failure from a provider the tenant holds credentials for (Twilio, SendGrid,
 * the platform email provider). 401/403 is a credential the provider refuses, 402 an account it
 * will not bill, 404 an account or endpoint that is not there: all of them fail every recipient
 * the same way. Anything else (a 400 for one address, a 429, a 5xx) is about this message.
 */
export function providerStatusScope(status: number | null | undefined): TransportErrorScope {
  return status === 401 || status === 402 || status === 403 || status === 404 ? 'sender' : 'recipient';
}

export interface CampaignSender {
  transport: CampaignTransport;
  channel: CampaignChannel;
  /** The From: actually delivered — recorded on the campaign so the ledger
   *  describes what recipients saw, not what the config says today. */
  fromLabel: string;
  send(message: TransportMessage): Promise<TransportReceipt>;
}

/** Everything a transport needs to resolve itself, read straight off the campaign row. */
export interface TransportBinding {
  transport: string;
  channel: string;
  senderIdentity: { fromEmail: string; fromName: string; status: string } | null;
  mailboxConnectionId: number | null;
  connectorConnectionId: string | null;
  fromName: string;
  /** E.164 sender for `channel='sms'`. */
  fromNumber: string | null;
}

export type TransportResult =
  | { ok: true; sender: CampaignSender }
  | { ok: false; error: string };

// `isE164` lives in `shared/contactAddress` (the do-not-contact check parses numbers too);
// re-exported here because this module is where campaign code has always imported it from.
export { isE164 } from '../shared/contactAddress';

/**
 * Resolve the SMS sender — the tenant's own Twilio connection.
 *
 * Deliberately the SAME `connector_connections` row the workflow builder and the
 * agent tools call `send_sms` through, resolved by the same runtime: a campaign
 * is not a second, differently-credentialled door to Twilio, and giving it one
 * would mean a tenant who revoked their Twilio key still had a live path to
 * their audience's phones.
 */
async function resolveSmsSender(
  db: Db,
  env: Env,
  tenantId: number,
  binding: TransportBinding,
): Promise<TransportResult> {
  const connectionId = binding.connectorConnectionId;
  if (!connectionId) return { ok: false, error: 'Choose a Twilio connection before sending.' };

  const fromNumber = (binding.fromNumber ?? '').trim();
  if (!fromNumber) return { ok: false, error: 'Set the Twilio number this campaign sends from.' };
  if (!isE164(fromNumber)) {
    return { ok: false, error: `"${fromNumber}" is not an E.164 number — it must look like +14155551234.` };
  }

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
  if (!connection) return { ok: false, error: 'That Twilio connection no longer exists.' };
  if (connection.connectorKey !== TWILIO_CONNECTOR_KEY) {
    return { ok: false, error: 'That connection is not a Twilio connection.' };
  }
  if (!connection.enabled) return { ok: false, error: `The "${connection.name}" connection is disabled.` };

  return {
    ok: true,
    sender: {
      transport: 'twilio',
      channel: 'sms',
      fromLabel: fromNumber,
      async send(message) {
        try {
          const result = await executeConnectorAction({
            db,
            env,
            tenantId,
            connectorKey: TWILIO_CONNECTOR_KEY,
            actionKey: 'send_sms',
            connectionId,
            actorKind: 'user',
            input: {
              To: message.to,
              From: fromNumber,
              Body: message.text ?? '',
              // Twilio only reports delivery to a URL it was given AT SEND TIME —
              // there is no way to ask afterwards — so a message sent without this
              // can never be more than "we handed it over".
              ...(message.statusCallbackUrl ? { StatusCallback: message.statusCallbackUrl } : {}),
            },
          });
          if (!result.ok) {
            const detail = twilioErrorDetail(result.data) ?? result.error;
            // 429 and 5xx are Twilio asking us to slow down. A 401/403 means the
            // credentials are wrong and every remaining recipient fails the same
            // way (sender scope), and a 400 is this message — a number Twilio will
            // not accept, or one that has texted STOP — which retrying cannot fix
            // but which says nothing about the next recipient (recipient scope).
            //
            // Status 0 is NO RESPONSE: `executeConnectorAction` does not throw on a fetch failure
            // or its timeout, it returns `{ ok: false, status: 0 }`. That, a 429 and a 5xx are all the
            // provider not serving us: retryable, and flagged (`providerUnavailable`) so the batch
            // stops instead of spending an attempt on every remaining row.
            //
            // A Twilio 400 can still be the SENDER's: its error code, read from the response body,
            // says when the From number itself is unusable ({@link TWILIO_SENDER_ERROR_CODES}).
            const retryable = isRetryableProviderStatus(result.status);
            throw new TransportError(
              `Twilio returned ${result.status}${detail ? `: ${detail}` : ''}`,
              retryable,
              twilioFailureScope(result.status, result.data),
              retryable,
            );
          }
          return { externalId: twilioMessageSid(result.data) };
        } catch (error) {
          if (error instanceof TransportError) throw error;
          // A ConnectorCallError is misconfiguration by construction (unknown
          // connector, missing credential, blocked URL) — never worth a retry, and
          // identical for every recipient, so it is the SENDER's failure.
          if (error instanceof ConnectorCallError) throw new TransportError(error.message, false, 'sender');
          // Unclassified throw (the runtime reports network failures as status 0 and does not throw
          // them, so this is rare): retried, so the scope is moot.
          throw new TransportError(error instanceof Error ? error.message : 'Twilio send failed', true, 'recipient');
        }
      },
    },
  };
}

/** Twilio's error body is `{ code, message, more_info }`. Naming the code is the
 *  difference between "Twilio returned 400" and "21610: the recipient replied
 *  STOP", which is the only version anybody can act on. */
function twilioErrorDetail(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const body = data as { message?: unknown };
  const code = twilioErrorCode(data);
  const message = typeof body.message === 'string' ? body.message : null;
  if (code && message) return `${code} ${message}`;
  return message ?? (code ? `error ${code}` : undefined);
}

/** `sid` off a Messages.json response — `SM…`. Absent means Twilio answered in a
 *  shape we do not recognise, and a made-up id would be worse than none. */
function twilioMessageSid(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const sid = (data as { sid?: unknown }).sid;
  return typeof sid === 'string' && sid ? sid.slice(0, 64) : undefined;
}

/**
 * Twilio's terminal "this person opted out" code.
 *
 * Exported because the SEND ledger is not the only thing that has to react to
 * it: a STOP is a consent withdrawal, so the audience member's `phone_status`
 * has to change too, or the next campaign texts them again and the one after
 * that does as well.
 */
export const TWILIO_OPT_OUT_CODE = '21610';

/**
 * The Twilio error code a failure value STARTS with, or null. Three shapes reach this: a bare code
 * (a delivery callback's `ErrorCode`), `Twilio returned <status>: <code> <text>`, and
 * `Twilio returned <status>: error <code>` (what {@link twilioErrorDetail} builds with no message).
 * The code is read from the start, never searched for: the text quotes the recipient's phone
 * number, whose digits can contain a code.
 */
export function twilioFailureCode(message: string): string | null {
  return /^(?:Twilio returned \d+: (?:error )?)?(\d+)\b/.exec(message.trim())?.[1] ?? null;
}

/** True when a failure means "they opted out": its Twilio code is {@link TWILIO_OPT_OUT_CODE}. */
export function isOptOutFailure(message: string): boolean {
  return twilioFailureCode(message) === TWILIO_OPT_OUT_CODE;
}

/**
 * Twilio error codes that are one RECIPIENT's fault, so a run of them says nothing about the
 * sender: ten landline numbers in a row fail identically and must not trip the circuit breaker.
 * Data, so a code is added here and nowhere else.
 *
 *   21211  invalid `To` number
 *   21217  `To` does not appear to be a valid number
 *   21408  SMS permission is not enabled for the region of the `To` number
 *   21612  the `To` number is not currently reachable via SMS
 *   21614  `To` is not a mobile number
 */
export const TWILIO_RECIPIENT_ERROR_CODES: readonly string[] = ['21211', '21217', '21408', '21612', '21614'];

/**
 * True when a failure is known to be one recipient's: an opt-out, or a Twilio code in
 * {@link TWILIO_RECIPIENT_ERROR_CODES}. The code comes from {@link twilioFailureCode}, which reads
 * the START of the message only.
 */
export function isPerRecipientCarrierFailure(message: string): boolean {
  if (isOptOutFailure(message)) return true;
  const code = twilioFailureCode(message);
  return code !== null && TWILIO_RECIPIENT_ERROR_CODES.includes(code);
}

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
  const channel: CampaignChannel = isCampaignChannel(binding.channel) ? binding.channel : 'email';
  const transport: CampaignTransport = isCampaignTransport(binding.transport)
    ? binding.transport
    : DEFAULT_TRANSPORT[channel];

  // Checked here rather than only at write time, because a campaign's channel and
  // its transport are set by two different calls and a row that drifted between
  // them would otherwise reach a send loop that has no branch for it.
  if (!transportSuitsChannel(channel, transport)) {
    return { ok: false, error: `A ${channel} campaign cannot send through ${transport}.` };
  }

  if (channel === 'sms') return resolveSmsSender(db, env, tenantId, binding);

  if (transport === 'platform') {
    const sender = binding.senderIdentity;
    if (!sender) return { ok: false, error: 'Choose a verified From address before sending.' };
    if (sender.status !== 'verified') return { ok: false, error: 'That From address is not verified yet.' };
    const fromLabel = sender.fromName ? `${sender.fromName} <${sender.fromEmail}>` : sender.fromEmail;
    return {
      ok: true,
      sender: {
        transport,
        channel,
        fromLabel,
        async send(message) {
          try {
            await sendRawEmail(env, { to: message.to, subject: message.subject, html: message.html, from: fromLabel });
            return {};
          } catch (error) {
            // The platform provider's own failures are transient far more often
            // than not (quota, upstream 5xx), and a misconfiguration would have
            // thrown before the campaign ever started. Always retried (bounded by
            // the attempt ceiling); a refused platform credential is still labelled
            // as the sender's, so the scope stays honest if this is ever made terminal.
            //
            // `providerUnavailable` only for a REAL provider status of 0, 429 or 5xx. Any other
            // failure here (a bounce for this address, a provider-side validation error, a throw
            // with no status) is about this message and must not stop the batch.
            const status = error instanceof EmailDeliveryError ? error.status : null;
            throw new TransportError(
              error instanceof Error ? error.message : 'Send failed',
              true,
              providerStatusScope(status),
              isRetryableProviderStatus(status),
            );
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
        channel,
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
          // `sendFromMailbox` answers 404 (mailbox gone) and 409 (grant revoked or needs
          // reconnecting) for the CONNECTION, and 502 for the one message the provider
          // refused or fumbled, so the status says whose failure it is.
          if (!result.ok) {
            throw new TransportError(result.error, result.retryable, result.status === 502 ? 'recipient' : 'sender', result.providerUnavailable === true);
          }
          return {};
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
      channel,
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
            // the API key is wrong and every remaining recipient would fail too
            // (sender scope). Other 4xx (a 400 for one address) are this message.
            // Status 0 (no response: a network error or timeout) is retryable too — see Twilio above.
            throw new TransportError(
              `SendGrid returned ${result.status}${result.error ? `: ${result.error}` : ''}`,
              isRetryableProviderStatus(result.status),
              providerStatusScope(result.status),
              isRetryableProviderStatus(result.status),
            );
          }
          return {};
        } catch (error) {
          if (error instanceof TransportError) throw error;
          // A ConnectorCallError is misconfiguration by construction (unknown
          // connector, missing credential, blocked URL) — never worth a retry, and
          // identical for every recipient, so it is the SENDER's failure.
          if (error instanceof ConnectorCallError) throw new TransportError(error.message, false, 'sender');
          throw new TransportError(error instanceof Error ? error.message : 'SendGrid send failed', true, 'recipient');
        }
      },
    },
  };
}
