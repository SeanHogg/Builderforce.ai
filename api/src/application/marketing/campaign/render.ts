/**
 * Campaign rendering — the message one recipient actually receives, and the
 * tracking URLs baked into it. Pure: no I/O. Split out of `../campaignEngine.ts`,
 * which re-exports it.
 */
import { escapeHtml } from '@builderforce/creation-canvas-contract';

// ---------------------------------------------------------------------------
// Campaign rendering
// ---------------------------------------------------------------------------

export interface RenderContext {
  /** Absolute origin serving the tracking endpoints. */
  trackingOrigin: string;
  trackToken: string;
  /**
   * Absolute URL for `{{logo}}`. Resolved ONCE per campaign, not per recipient:
   * it is a tenant-level fact and a per-recipient lookup would add a query per
   * message to the hottest loop in the product.
   */
  logoUrl?: string | null;
}

/**
 * The origin baked into an email's tracking links — ONE resolver.
 *
 * It cannot be the request origin: a campaign that starts from an interactive
 * request and finishes on the cron sweep would otherwise stamp two different
 * hosts into the same campaign's links, and links already delivered must keep
 * working forever. Defaults to the same-origin gateway path (`builderforce.ai/
 * gateway`), which is the one host corporate networks reliably allow — an
 * unsubscribe link that a recipient's firewall blocks is a compliance problem,
 * not an inconvenience.
 */
export function resolveTrackingOrigin(env: { CAMPAIGN_TRACKING_ORIGIN?: string }): string {
  return (env.CAMPAIGN_TRACKING_ORIGIN ?? 'https://builderforce.ai/gateway').replace(/\/+$/, '');
}

/** The tracking URLs for one recipient. Kept together so the renderer and the
 *  route handlers cannot disagree about the path shape. */
export function trackingUrls(ctx: RenderContext) {
  const base = `${ctx.trackingOrigin.replace(/\/+$/, '')}/api/campaign-track`;
  return {
    open: `${base}/open/${ctx.trackToken}.gif`,
    click: `${base}/click/${ctx.trackToken}`,
    unsubscribe: `${base}/unsubscribe/${ctx.trackToken}`,
  };
}

/** Where Twilio reports this message's delivery state. Same token, same router,
 *  same "one token resolves to one send" property the other three rely on. */
export function smsStatusUrl(ctx: RenderContext): string {
  return `${ctx.trackingOrigin.replace(/\/+$/, '')}/api/campaign-track/sms-status/${ctx.trackToken}`;
}

/** Escape a string for safe interpolation into HTML. */
/**
 * Render the message actually sent to one recipient.
 *
 * Four things happen here and nowhere else, so no campaign can ship without
 * them: outbound links are rewritten through the click tracker, an open pixel is
 * appended, an unsubscribe footer is added, and merge fields are substituted
 * with ESCAPED values — recipient attributes are attacker-controlled in the
 * ordinary case (anyone can type `<script>` into a signup form), so unescaped
 * interpolation here would be a stored XSS in the campaign preview.
 *
 * Pure — no I/O — so the link rewriting (the part with real injection risk) is
 * directly unit-testable.
 */
export interface CampaignRecipient {
  email: string;
  name?: string;
  attributes?: Record<string, unknown>;
}

/**
 * Substitute `{{field}}` placeholders — the ONE implementation, shared by the
 * HTML and the SMS renderer.
 *
 * `escape` is a parameter rather than a constant because the two channels differ
 * on exactly this point and on nothing else. HTML must escape: recipient
 * attributes are attacker-controlled in the ordinary case (anyone can type
 * `<script>` into a signup form), so unescaped interpolation would be a stored
 * XSS in the campaign preview. A text message has no markup to inject into, and
 * escaping there would deliver a literal `&amp;` to a phone.
 */
function substituteMergeFields(
  body: string,
  recipient: CampaignRecipient,
  fixed: { logo: string; unsubscribe: string },
  escape: (value: string) => string,
): string {
  const merged = String(body ?? '')
    .replace(/\{\{\s*name\s*\}\}/g, escape(recipient.name || ''))
    .replace(/\{\{\s*email\s*\}\}/g, escape(recipient.email))
    .replace(/\{\{\s*logo\s*\}\}/g, escape(fixed.logo))
    .replace(/\{\{\s*unsubscribe\s*\}\}/g, fixed.unsubscribe);

  // Audience attributes fill the template's own merge fields. An UNMATCHED field
  // resolves to empty rather than being left as `{{company}}` — mailing 4,000
  // people a literal placeholder is worse than mailing them a gap, and the
  // composer already warns the author which fields their audience is missing.
  return merged.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]{0,63})\s*\}\}/g, (_whole, field: string) => {
    const value = recipient.attributes?.[field];
    return value == null ? '' : escape(String(value));
  });
}

/** The longest body an author can store. Twilio concatenates beyond one segment
 *  and bills per segment, so this is a spend ceiling as much as a length one —
 *  roughly ten segments, which is already far past what anybody should text. */
export const SMS_BODY_MAX_CHARS = 1_600;

/** The opt-out sentence every campaign text carries. Wording, not decoration:
 *  US A2P registration requires a visible opt-out on campaign traffic, and STOP
 *  is the keyword carriers act on. */
export const SMS_OPT_OUT_NOTICE = 'Reply STOP to opt out.';

/**
 * Render the text message actually sent to one recipient.
 *
 * Pure, and deliberately NOT the email renderer with the tags stripped. Three of
 * the four things `renderCampaignEmail` does are meaningless here: there is no
 * link to rewrite through a click tracker, no pixel to append, and no HTML
 * footer. The fourth — a working way out — still applies, and is appended HERE
 * rather than left to the author for exactly the reason the email footer is.
 */
export function renderCampaignSms(bodyText: string, recipient: CampaignRecipient): string {
  const merged = substituteMergeFields(
    bodyText,
    recipient,
    // `{{logo}}` has nothing to resolve to in a text message, and `{{unsubscribe}}`
    // is not a URL — the way out of an SMS is the keyword, not a link.
    { logo: '', unsubscribe: SMS_OPT_OUT_NOTICE },
    (value) => value,
  ).trim();

  // Appended only when the author has not already said it, so a body that ends
  // "...or reply stop" does not get a second, redundant sentence — and a body
  // that says nothing cannot be sent without one.
  const withNotice = /\bSTOP\b/i.test(merged) ? merged : `${merged} ${SMS_OPT_OUT_NOTICE}`.trim();
  return withNotice.slice(0, SMS_BODY_MAX_CHARS);
}

export function renderCampaignEmail(
  bodyHtml: string,
  ctx: RenderContext,
  recipient: CampaignRecipient,
): string {
  const urls = trackingUrls(ctx);

  const merged = substituteMergeFields(
    bodyHtml,
    recipient,
    { logo: ctx.logoUrl ?? '', unsubscribe: urls.unsubscribe },
    escapeHtml,
  );

  // Rewrite only http(s) hrefs. mailto:, tel: and anchors are left alone, and
  // the tracker's own links are skipped so a second render cannot double-wrap.
  const tracked = merged.replace(
    /href\s*=\s*"(https?:\/\/[^"]+)"/gi,
    (whole, url: string) => {
      if (url.startsWith(urls.click) || url.startsWith(urls.unsubscribe)) return whole;
      return `href="${urls.click}?u=${encodeURIComponent(url)}"`;
    },
  );

  const footer =
    `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;`
    + `font:12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#6b7280">`
    + `<a href="${urls.unsubscribe}" style="color:#6b7280">Unsubscribe</a>`
    + `</div>`;
  const pixel = `<img src="${urls.open}" width="1" height="1" alt="" style="display:none">`;

  return `${tracked}${footer}${pixel}`;
}
