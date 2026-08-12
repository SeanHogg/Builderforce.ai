/**
 * The PAYOUT DESTINATION port — where a person's money is sent, behind one
 * interface.
 *
 * The platform already had a payout SEAM (`application/integrations/payments.ts`)
 * and it answered exactly one question: "is a partner webhook configured for this
 * deployment?" That is an operator's answer, not an earner's. A sales associate
 * who converts a referral, or a freelancer who invoices an engagement, has to be
 * able to say WHERE their money goes — a bank account, a PayPal balance, a Stripe
 * Connect account — and the deployment cannot know that on their behalf.
 *
 * So this is the sixth port in the same family as mailbox / drive / calendar /
 * board / connector: a small registry of adapters, each absorbing one vendor's
 * shape, with everything above it speaking {@link PayoutProvider} and never
 * knowing which vendor is underneath. Three consequences worth stating, because
 * each is a thing that would otherwise be re-decided per surface:
 *
 *   • **Connect style is declared, not inferred.** Stripe and PayPal are OAuth
 *     grants; a bank account and a Wise business account are FIELDS the earner
 *     types. Both are "connect an account" to the person doing it, so both are
 *     rows here rather than two different features.
 *   • **Nothing secret is ever returned.** An adapter's `describe()` produces the
 *     masked label a UI may show (`•••• 4321`, the PayPal address). The stored
 *     credential is encrypted at rest and only {@link PayoutProvider.sendPayout}
 *     ever sees it.
 *   • **A payout has one shape.** {@link PayoutResult} is what every adapter
 *     returns, so the ledger and the UI never branch per vendor.
 */

import { isProviderOAuthConfigured, type OAuthProviderConfig } from '../shared/providerOAuthConnect';

export const PAYOUT_PROVIDER_NAMES = ['stripe', 'paypal', 'bank', 'wise'] as const;
export type PayoutProviderName = (typeof PAYOUT_PROVIDER_NAMES)[number];

export function isPayoutProviderName(value: unknown): value is PayoutProviderName {
  return typeof value === 'string' && (PAYOUT_PROVIDER_NAMES as readonly string[]).includes(value);
}

/** One field an earner types when the provider is not an OAuth grant. */
export interface PayoutField {
  key: string;
  label: string;
  /** Never returned once stored; only the adapter's `describe()` may summarise it. */
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
}

/** What a connected destination looks like to a UI. No secrets, ever. */
export interface PayoutAccountSummary {
  /** e.g. "Chase •••• 4321", "ada@example.com", "acct_1Nc…". */
  label: string;
  /** ISO-4217, when the destination pins one. */
  currency: string | null;
  country: string | null;
}

export interface PayoutRequest {
  amountCents: number;
  currency: string;
  /** Idempotency key — a retried webhook must never pay twice. */
  reference: string;
  memo: string;
}

export type PayoutResult =
  | { ok: true; externalRef: string | null; status: 'paid' | 'pending' }
  | { ok: false; error: string; retryable: boolean };

/**
 * The stored credential, decrypted. A `fields` provider holds exactly what the
 * earner typed; an `oauth` provider holds the token set.
 */
export interface PayoutCredential {
  fields?: Record<string, string>;
  accessToken?: string;
  refreshToken?: string;
  /** The vendor's own id for the connected account (Stripe `acct_…`, PayPal payer id). */
  externalAccountId?: string;
}

export interface PayoutProvider {
  name: PayoutProviderName;
  label: string;
  /** One-line description rendered under the provider's name. */
  blurb: string;
  connect: 'oauth' | 'fields';
  /** `fields` providers only. */
  fields?: readonly PayoutField[];
  /** `oauth` providers only — the same shape every other port declares. */
  oauth?: OAuthProviderConfig;
  /** Masked summary for a UI, from the stored credential. */
  describe(credential: PayoutCredential): PayoutAccountSummary;
  /**
   * Move money. `null` externalRef means the vendor accepted it without giving a
   * reference back, which is a success with nothing to reconcile against.
   */
  sendPayout(credential: PayoutCredential, request: PayoutRequest): Promise<PayoutResult>;
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

const last4 = (value: string | undefined): string => (value ?? '').replace(/\D/g, '').slice(-4);

/** Vendor HTTP failures are retryable when they are the vendor's fault, not the
 *  earner's — a 5xx or a rate limit will succeed on the next sweep; a 400 will
 *  not, and retrying it forever is how a queue becomes a hot loop. */
const retryableStatus = (status: number): boolean => status === 429 || status >= 500;

async function vendorError(label: string, res: Response): Promise<PayoutResult> {
  const body = await res.text().catch(() => '');
  return { ok: false, error: `${label} failed (${res.status}): ${body.slice(0, 240)}`, retryable: retryableStatus(res.status) };
}

/* ── Stripe Connect ──────────────────────────────────────────────────────── */

/**
 * Stripe Connect (Standard). The earner grants us the right to transfer to their
 * own Stripe account; the platform's secret key is what authenticates the
 * transfer, and `destination` is their `acct_…`. That is deliberately the
 * Standard flow rather than Express: the account stays theirs, and we never hold
 * their balance.
 */
const stripePayout: PayoutProvider = {
  name: 'stripe',
  label: 'Stripe',
  blurb: 'Transfer earnings to your own Stripe account. Payouts follow your Stripe schedule.',
  connect: 'oauth',
  oauth: {
    authUrl: 'https://connect.stripe.com/oauth/authorize',
    tokenUrl: 'https://connect.stripe.com/oauth/token',
    scopes: ['read_write'],
    clientIdKey: 'STRIPE_CONNECT_CLIENT_ID',
    clientSecretKey: 'STRIPE_SECRET_KEY',
    extraAuthParams: { stripe_landing: 'login' },
  },
  describe(credential) {
    return { label: credential.externalAccountId ?? 'Stripe account', currency: null, country: null };
  },
  async sendPayout(credential, request) {
    const destination = credential.externalAccountId;
    const platformKey = credential.fields?.platformSecretKey;
    if (!destination) return { ok: false, error: 'Stripe account is not connected', retryable: false };
    if (!platformKey) return { ok: false, error: 'Stripe is not configured on this deployment', retryable: false };
    const body = new URLSearchParams({
      amount: String(request.amountCents),
      currency: request.currency.toLowerCase(),
      destination,
      description: request.memo.slice(0, 200),
    });
    const res = await fetch('https://api.stripe.com/v1/transfers', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${platformKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // Stripe's own idempotency, keyed by our reference — a retried sweep
        // returns the ORIGINAL transfer instead of creating a second one.
        'Idempotency-Key': request.reference,
      },
      body,
    });
    if (!res.ok) return vendorError('Stripe transfer', res);
    const json = await res.json().catch(() => ({})) as { id?: string };
    return { ok: true, externalRef: json.id ?? null, status: 'paid' };
  },
};

/* ── PayPal Payouts ──────────────────────────────────────────────────────── */

const paypalPayout: PayoutProvider = {
  name: 'paypal',
  label: 'PayPal',
  blurb: 'Send earnings to a PayPal balance. Available in most countries, usually same-day.',
  connect: 'oauth',
  oauth: {
    authUrl: 'https://www.paypal.com/connect',
    tokenUrl: 'https://api-m.paypal.com/v1/oauth2/token',
    scopes: ['openid', 'email', 'https://uri.paypal.com/services/paypalattributes'],
    clientIdKey: 'PAYPAL_CLIENT_ID',
    clientSecretKey: 'PAYPAL_CLIENT_SECRET',
    extraAuthParams: { flowEntry: 'static' },
  },
  describe(credential) {
    return { label: credential.fields?.email ?? credential.externalAccountId ?? 'PayPal account', currency: null, country: null };
  },
  async sendPayout(credential, request) {
    const receiver = credential.fields?.email;
    const token = credential.accessToken;
    if (!receiver) return { ok: false, error: 'PayPal account has no payout email', retryable: false };
    if (!token) return { ok: false, error: 'PayPal grant has expired — reconnect the account', retryable: false };
    const res = await fetch('https://api-m.paypal.com/v1/payments/payouts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender_batch_header: { sender_batch_id: request.reference, email_subject: request.memo.slice(0, 120) },
        items: [{
          recipient_type: 'EMAIL',
          receiver,
          amount: { value: (request.amountCents / 100).toFixed(2), currency: request.currency.toUpperCase() },
          note: request.memo.slice(0, 200),
          sender_item_id: request.reference,
        }],
      }),
    });
    if (!res.ok) return vendorError('PayPal payout', res);
    const json = await res.json().catch(() => ({})) as { batch_header?: { payout_batch_id?: string } };
    // PayPal ACCEPTS a batch and settles it asynchronously, so this is `pending`
    // rather than `paid` — reporting it as paid would put money in a report that
    // has not left the building.
    return { ok: true, externalRef: json.batch_header?.payout_batch_id ?? null, status: 'pending' };
  },
};

/* ── Bank account (ACH / SEPA / local transfer) ──────────────────────────── */

/**
 * A bank account typed by the earner.
 *
 * There is no adapter API to call: settlement happens through whatever rail the
 * deployment's finance operation uses, which is exactly what `PAYOUT_WEBHOOK_URL`
 * has always been for. So this adapter's `sendPayout` returns `pending` with no
 * reference — the money movement is somebody's job, and pretending otherwise
 * would mark an invoice paid that nobody paid.
 */
const bankPayout: PayoutProvider = {
  name: 'bank',
  label: 'Bank account',
  blurb: 'Direct deposit to a bank account (ACH, SEPA or local transfer).',
  connect: 'fields',
  fields: [
    { key: 'accountHolder', label: 'Account holder name', secret: false, required: true, placeholder: 'Ada Lovelace' },
    { key: 'bankName', label: 'Bank name', secret: false, required: true, placeholder: 'Chase' },
    { key: 'country', label: 'Country', secret: false, required: true, placeholder: 'US', help: 'ISO country code' },
    { key: 'currency', label: 'Currency', secret: false, required: true, placeholder: 'USD' },
    { key: 'routingNumber', label: 'Routing / sort code / BIC', secret: true, required: false, placeholder: '021000021' },
    { key: 'accountNumber', label: 'Account number / IBAN', secret: true, required: true, placeholder: '000123456789' },
  ],
  describe(credential) {
    const fields = credential.fields ?? {};
    const tail = last4(fields.accountNumber);
    return {
      label: [fields.bankName, tail ? `•••• ${tail}` : ''].filter(Boolean).join(' ') || 'Bank account',
      currency: fields.currency?.toUpperCase() || null,
      country: fields.country?.toUpperCase() || null,
    };
  },
  async sendPayout() {
    return { ok: true, externalRef: null, status: 'pending' };
  },
};

/* ── Wise ────────────────────────────────────────────────────────────────── */

const wisePayout: PayoutProvider = {
  name: 'wise',
  label: 'Wise',
  blurb: 'Cross-border payouts at the real exchange rate, using your own Wise business account.',
  connect: 'fields',
  fields: [
    { key: 'apiToken', label: 'Wise API token', secret: true, required: true, placeholder: '••••', help: 'Wise → Settings → API tokens' },
    { key: 'profileId', label: 'Profile id', secret: false, required: true, placeholder: '12345678' },
    { key: 'recipientId', label: 'Recipient account id', secret: false, required: true, placeholder: '87654321' },
    { key: 'currency', label: 'Currency', secret: false, required: true, placeholder: 'USD' },
  ],
  describe(credential) {
    const fields = credential.fields ?? {};
    return {
      label: fields.recipientId ? `Wise recipient ${fields.recipientId}` : 'Wise account',
      currency: fields.currency?.toUpperCase() || null,
      country: null,
    };
  },
  async sendPayout(credential, request) {
    const fields = credential.fields ?? {};
    if (!fields.apiToken || !fields.profileId || !fields.recipientId) {
      return { ok: false, error: 'Wise account is missing a token, profile or recipient', retryable: false };
    }
    // Wise is a two-step rail: quote, then transfer against it. The quote is
    // priced per request, so it cannot be cached across payouts.
    const quoteRes = await fetch(`https://api.wise.com/v3/profiles/${encodeURIComponent(fields.profileId)}/quotes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${fields.apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceCurrency: request.currency.toUpperCase(),
        targetCurrency: (fields.currency || request.currency).toUpperCase(),
        sourceAmount: request.amountCents / 100,
        targetAccount: Number(fields.recipientId),
      }),
    });
    if (!quoteRes.ok) return vendorError('Wise quote', quoteRes);
    const quote = await quoteRes.json().catch(() => ({})) as { id?: string };
    if (!quote.id) return { ok: false, error: 'Wise returned a quote with no id', retryable: true };

    const transferRes = await fetch('https://api.wise.com/v1/transfers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${fields.apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetAccount: Number(fields.recipientId),
        quoteUuid: quote.id,
        customerTransactionId: request.reference,
        details: { reference: request.memo.slice(0, 100) },
      }),
    });
    if (!transferRes.ok) return vendorError('Wise transfer', transferRes);
    const transfer = await transferRes.json().catch(() => ({})) as { id?: number | string };
    return { ok: true, externalRef: transfer.id == null ? null : String(transfer.id), status: 'pending' };
  },
};

/* ── registry ────────────────────────────────────────────────────────────── */

const PROVIDERS: Record<PayoutProviderName, PayoutProvider> = {
  stripe: stripePayout,
  paypal: paypalPayout,
  bank: bankPayout,
  wise: wisePayout,
};

export function getPayoutProvider(name: string): PayoutProvider | null {
  return isPayoutProviderName(name) ? PROVIDERS[name] : null;
}

export interface PayoutProviderDescriptor {
  name: PayoutProviderName;
  label: string;
  blurb: string;
  connect: 'oauth' | 'fields';
  /** Secret VALUES never leave the server; the field DECLARATIONS must, or the
   *  form cannot be rendered. */
  fields: PayoutField[];
  /** False for an OAuth provider whose client credentials are absent here. A
   *  `fields` provider is always connectable — the earner supplies everything. */
  configured: boolean;
}

/**
 * What this deployment can actually offer. Reported rather than assumed, for the
 * same reason the mailbox port reports it: advertising Stripe with no
 * `STRIPE_CONNECT_CLIENT_ID` bound sends someone to a consent screen that cannot
 * complete.
 */
export function describePayoutProviders(env: Record<string, unknown>): PayoutProviderDescriptor[] {
  return PAYOUT_PROVIDER_NAMES.map((name) => {
    const provider = PROVIDERS[name];
    return {
      name,
      label: provider.label,
      blurb: provider.blurb,
      connect: provider.connect,
      fields: [...(provider.fields ?? [])],
      configured: provider.connect === 'fields' || (provider.oauth != null && isProviderOAuthConfigured(env, provider.oauth)),
    };
  });
}
