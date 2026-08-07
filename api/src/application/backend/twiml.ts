/**
 * TwiML — the XML document Twilio expects back from a webhook.
 *
 * A Twilio webhook is not a normal API call: Twilio POSTs to you mid-event (an
 * SMS arriving, a caller waiting on the line) and the RESPONSE BODY is the
 * program. Return the wrong shape and the call drops or the message is silently
 * dropped, with the only diagnostic living in Twilio's console.
 *
 * So TwiML is generated from a small validated node list rather than composed as
 * strings by whoever is writing a handler. Two reasons:
 *   • Escaping. Every text node here is user- or model-supplied (an inbound SMS
 *     body echoed back, an LLM-drafted reply). One unescaped `&` produces a
 *     malformed document and a dropped call. {@link escapeXml} is applied to
 *     every value on the way out and cannot be bypassed by a handler author.
 *   • Verb coverage is a CONTRACT. A handler spec lives in the canvas as JSON and
 *     is executed server-side; the node vocabulary is what the platform promises
 *     to support, so it is declared in one place and validated on parse.
 *
 * Nested verbs are supported exactly where Twilio nests them: `<Gather>` wraps
 * prompt verbs (`Say`/`Play`), which is what makes an IVR menu possible at all.
 */

/** Escape the five XML metacharacters. Applied to every text node and attribute. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** A prompt verb — the only things `<Gather>` may contain. */
export interface TwimlSay {
  say: string;
  /** Twilio voice name (e.g. `Polly.Joanna`). */
  voice?: string;
  /** BCP-47 language tag (e.g. `en-GB`). */
  language?: string;
}
export interface TwimlPlay {
  /** Absolute URL of an audio file Twilio will fetch and play. */
  play: string;
  loop?: number;
}
export type TwimlPrompt = TwimlSay | TwimlPlay;

export interface TwimlMessage {
  /** Body of an outbound SMS/WhatsApp reply. */
  message: string;
  /** Media URL(s) for MMS / WhatsApp attachments. */
  media?: string[];
}
export interface TwimlGather {
  gather: {
    /** Where Twilio POSTs the caller's input. Relative to the handler's ingress. */
    action?: string;
    /** 'dtmf' (keypad) | 'speech' | 'dtmf speech'. */
    input?: string;
    numDigits?: number;
    /** Seconds of silence before Twilio gives up and falls through. */
    timeout?: number;
    /** Prompts played while listening. */
    prompts?: TwimlPrompt[];
  };
}
export interface TwimlDial {
  /** E.164 number, SIP URI or client identifier to bridge the call to. */
  dial: string;
  /** Caller id presented to the dialled party. */
  callerId?: string;
  timeout?: number;
  /** Absolute or ingress-relative URL Twilio POSTs when the dialled leg ends. */
  action?: string;
}
/**
 * `<ConversationRelay>` — hand a LIVE CALL to a conversational AI.
 *
 * Twilio streams the caller's speech to `url` over a WebSocket and speaks back
 * whatever that socket returns, so the AI holds the conversation in real time
 * instead of the call being a menu. This is the voice half of Twilio's
 * Conversational AI surface; the text half is the `twilio-assistants` connector.
 *
 * ── WHY THIS IS A NODE AND NOT A CONNECTOR ACTION ───────────────────────────
 * It is not a REST call. It is an instruction inside the TwiML a voice webhook
 * ALREADY returns, and it takes over the call for its duration — so it belongs
 * in the response vocabulary next to `<Gather>` and `<Dial>`, which is where an
 * author is when they decide what the call should do next.
 *
 * `url` MUST be `wss://`. Twilio refuses a non-secure socket, and a handler that
 * emitted one would fail mid-call rather than at author time — which is why the
 * parser rejects it here instead.
 */
export interface TwimlConversationRelay {
  conversationRelay: {
    /** `wss://` endpoint Twilio streams the call audio to. */
    url: string;
    /** Spoken first, before the caller says anything. */
    welcomeGreeting?: string;
    /** Text-to-speech voice for the AI's replies. */
    voice?: string;
    /** BCP-47 language for both recognition and speech, e.g. `en-US`. */
    language?: string;
    /** Speech-to-text provider, when overriding the account default. */
    transcriptionProvider?: string;
    /** Let the caller talk over the AI. Off by default, as Twilio has it. */
    interruptible?: boolean;
    /** Send DTMF keypresses to the socket as well as speech. */
    dtmfDetection?: boolean;
  };
}

export interface TwimlRedirect { redirect: string }
export interface TwimlHangup { hangup: true }
export interface TwimlReject { reject: true; reason?: 'rejected' | 'busy' }
export interface TwimlPause { pause: number }

export type TwimlNode =
  | TwimlSay
  | TwimlPlay
  | TwimlMessage
  | TwimlGather
  | TwimlDial
  | TwimlConversationRelay
  | TwimlRedirect
  | TwimlHangup
  | TwimlReject
  | TwimlPause;

const attr = (name: string, value: unknown): string =>
  value === undefined || value === null || value === '' ? '' : ` ${name}="${escapeXml(String(value))}"`;

function renderPrompt(node: TwimlPrompt): string {
  if ('play' in node) {
    return `<Play${attr('loop', node.loop)}>${escapeXml(node.play)}</Play>`;
  }
  return `<Say${attr('voice', node.voice)}${attr('language', node.language)}>${escapeXml(node.say)}</Say>`;
}

function renderNode(node: TwimlNode): string {
  if ('message' in node) {
    const media = (node.media ?? []).map((m) => `<Media>${escapeXml(m)}</Media>`).join('');
    // `<Body>` is required as soon as `<Media>` is present; a bare text child is
    // only valid for a body-only message.
    return media
      ? `<Message><Body>${escapeXml(node.message)}</Body>${media}</Message>`
      : `<Message>${escapeXml(node.message)}</Message>`;
  }
  if ('gather' in node) {
    const g = node.gather;
    const inner = (g.prompts ?? []).map(renderPrompt).join('');
    return `<Gather${attr('action', g.action)}${attr('input', g.input)}${attr('numDigits', g.numDigits)}${attr('timeout', g.timeout)}>${inner}</Gather>`;
  }
  if ('dial' in node) {
    return `<Dial${attr('callerId', node.callerId)}${attr('timeout', node.timeout)}${attr('action', node.action)}>${escapeXml(node.dial)}</Dial>`;
  }
  if ('conversationRelay' in node) {
    const c = node.conversationRelay;
    // `<ConversationRelay>` is only valid INSIDE `<Connect>`; emitting it bare
    // produces a document Twilio rejects, so the wrapper is written here rather
    // than left to the author to remember.
    return `<Connect><ConversationRelay${attr('url', c.url)}${attr('welcomeGreeting', c.welcomeGreeting)}` +
      `${attr('voice', c.voice)}${attr('language', c.language)}${attr('transcriptionProvider', c.transcriptionProvider)}` +
      `${attr('interruptible', c.interruptible)}${attr('dtmfDetection', c.dtmfDetection)}/></Connect>`;
  }
  if ('redirect' in node) return `<Redirect>${escapeXml(node.redirect)}</Redirect>`;
  if ('hangup' in node) return '<Hangup/>';
  if ('reject' in node) return `<Reject${attr('reason', node.reason)}/>`;
  if ('pause' in node) return `<Pause${attr('length', node.pause)}/>`;
  return renderPrompt(node);
}

/**
 * Render a node list into a complete TwiML document.
 *
 * An EMPTY list is legitimate and renders `<Response/>` — that is Twilio's "do
 * nothing further" and is the correct reply to, say, a status callback. Returning
 * an empty BODY instead is an error Twilio reports as a malformed document.
 */
export function renderTwiml(nodes: readonly TwimlNode[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${nodes.map(renderNode).join('')}</Response>`;
}

/** Content type Twilio requires. Getting this wrong fails the document silently. */
export const TWIML_CONTENT_TYPE = 'text/xml; charset=utf-8';

// ---------------------------------------------------------------------------
// Parsing (handler specs are untrusted JSON from the canvas)
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function parsePrompt(raw: unknown): TwimlPrompt | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.play === 'string') return { play: raw.play, ...(num(raw.loop) !== undefined ? { loop: num(raw.loop)! } : {}) };
  if (typeof raw.say === 'string') {
    return {
      say: raw.say,
      ...(str(raw.voice) ? { voice: str(raw.voice)! } : {}),
      ...(str(raw.language) ? { language: str(raw.language)! } : {}),
    };
  }
  return null;
}

/**
 * Parse one untrusted node. Returns null for anything unrecognised so a typo in a
 * handler spec DROPS that node rather than producing a document Twilio rejects
 * wholesale — a partially-working IVR is diagnosable; a malformed one is not.
 */
export function parseTwimlNode(raw: unknown): TwimlNode | null {
  if (!isRecord(raw)) return null;

  if (typeof raw.message === 'string') {
    const media = Array.isArray(raw.media) ? raw.media.filter((m): m is string => typeof m === 'string') : [];
    return { message: raw.message, ...(media.length ? { media } : {}) };
  }
  if (isRecord(raw.gather)) {
    const g = raw.gather;
    const prompts = Array.isArray(g.prompts)
      ? g.prompts.map(parsePrompt).filter((p): p is TwimlPrompt => p !== null)
      : [];
    return {
      gather: {
        ...(str(g.action) ? { action: str(g.action)! } : {}),
        ...(str(g.input) ? { input: str(g.input)! } : {}),
        ...(num(g.numDigits) !== undefined ? { numDigits: num(g.numDigits)! } : {}),
        ...(num(g.timeout) !== undefined ? { timeout: num(g.timeout)! } : {}),
        ...(prompts.length ? { prompts } : {}),
      },
    };
  }
  if (typeof raw.dial === 'string') {
    return {
      dial: raw.dial,
      ...(str(raw.callerId) ? { callerId: str(raw.callerId)! } : {}),
      ...(num(raw.timeout) !== undefined ? { timeout: num(raw.timeout)! } : {}),
      ...(str(raw.action) ? { action: str(raw.action)! } : {}),
    };
  }
  if (isRecord(raw.conversationRelay)) {
    const c = raw.conversationRelay;
    const url = str(c.url);
    // Rejected at AUTHOR time rather than mid-call: Twilio refuses a non-`wss://`
    // socket, and discovering that when a customer is on the line is the worst
    // possible moment. Returning null drops the node, which degrades the reply
    // instead of producing a document Twilio cannot parse at all.
    if (!url || !url.startsWith('wss://')) return null;
    return {
      conversationRelay: {
        url,
        ...(str(c.welcomeGreeting) ? { welcomeGreeting: str(c.welcomeGreeting)! } : {}),
        ...(str(c.voice) ? { voice: str(c.voice)! } : {}),
        ...(str(c.language) ? { language: str(c.language)! } : {}),
        ...(str(c.transcriptionProvider) ? { transcriptionProvider: str(c.transcriptionProvider)! } : {}),
        ...(typeof c.interruptible === 'boolean' ? { interruptible: c.interruptible } : {}),
        ...(typeof c.dtmfDetection === 'boolean' ? { dtmfDetection: c.dtmfDetection } : {}),
      },
    };
  }
  if (typeof raw.redirect === 'string') return { redirect: raw.redirect };
  if (raw.hangup === true) return { hangup: true };
  if (raw.reject === true) {
    return { reject: true, ...(raw.reason === 'busy' ? { reason: 'busy' as const } : {}) };
  }
  if (num(raw.pause) !== undefined) return { pause: num(raw.pause)! };
  return parsePrompt(raw);
}

/** Parse an untrusted node LIST, dropping unrecognised entries. */
export function parseTwimlNodes(raw: unknown): TwimlNode[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseTwimlNode).filter((n): n is TwimlNode => n !== null);
}
