/**
 * TwiML contract tests.
 *
 * Every assertion here corresponds to a failure a customer would experience as
 * "the call dropped" or "the reply never arrived", with the only diagnostic in
 * Twilio's console: an unescaped metacharacter, a `<Media>` without a `<Body>`,
 * an empty document, a `<Gather>` with its prompts flattened out.
 */
import { describe, it, expect } from 'vitest';
import { escapeXml, parseTwimlNode, parseTwimlNodes, renderTwiml } from './twiml';

describe('escapeXml', () => {
  it('escapes all five XML metacharacters', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });

  it('escapes ampersand first so entities are not double-broken', () => {
    // A naive ordering that escapes `<` before `&` produces `&amp;lt;`.
    expect(escapeXml('<')).toBe('&lt;');
    expect(escapeXml('&lt;')).toBe('&amp;lt;');
  });
});

describe('renderTwiml', () => {
  it('renders an empty node list as a well-formed do-nothing document', () => {
    // Twilio reports an empty BODY as a malformed document. An empty `<Response>`
    // is the correct "nothing further" and is what a status callback returns.
    expect(renderTwiml([])).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });

  it('escapes message bodies — an inbound SMS echoed back is attacker-controlled', () => {
    const xml = renderTwiml([{ message: 'Tom & Jerry <script>alert(1)</script>' }]);
    expect(xml).toContain('<Message>Tom &amp; Jerry &lt;script&gt;alert(1)&lt;/script&gt;</Message>');
    expect(xml).not.toContain('<script>');
  });

  it('wraps the body in <Body> only when media is present', () => {
    expect(renderTwiml([{ message: 'hi' }])).toContain('<Message>hi</Message>');
    const withMedia = renderTwiml([{ message: 'hi', media: ['https://x.test/a.png'] }]);
    expect(withMedia).toContain('<Message><Body>hi</Body><Media>https://x.test/a.png</Media></Message>');
  });

  it('nests prompts inside <Gather> — the flattened form plays before listening', () => {
    const xml = renderTwiml([
      { gather: { action: 'https://x.test/ivr', input: 'dtmf', numDigits: 1, prompts: [{ say: 'Press one' }] } },
    ]);
    expect(xml).toContain('<Gather action="https://x.test/ivr" input="dtmf" numDigits="1"><Say>Press one</Say></Gather>');
  });

  it('omits empty attributes rather than emitting name=""', () => {
    const xml = renderTwiml([{ say: 'hello' }]);
    expect(xml).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Say>hello</Say></Response>');
  });

  it('renders the voice verbs an IVR needs', () => {
    const xml = renderTwiml([{ dial: '+14155551234', callerId: '+15005550006' }, { pause: 2 }, { hangup: true }]);
    expect(xml).toContain('<Dial callerId="+15005550006">+14155551234</Dial>');
    expect(xml).toContain('<Pause length="2"/>');
    expect(xml).toContain('<Hangup/>');
  });
});

describe('parseTwimlNode', () => {
  it('drops an unrecognised node instead of emitting invalid markup', () => {
    expect(parseTwimlNode({ shout: 'hi' })).toBeNull();
    expect(parseTwimlNode('not an object')).toBeNull();
  });

  it('keeps the good nodes when one is malformed', () => {
    // A partially-working IVR is diagnosable; a document Twilio rejects is not.
    const nodes = parseTwimlNodes([{ say: 'ok' }, { nonsense: true }, { hangup: true }]);
    expect(nodes).toHaveLength(2);
  });

  it('parses a gather with its prompts', () => {
    const node = parseTwimlNode({ gather: { numDigits: 1, prompts: [{ say: 'Press 1' }, { play: 'https://x.test/a.mp3' }] } });
    expect(node).toEqual({ gather: { numDigits: 1, prompts: [{ say: 'Press 1' }, { play: 'https://x.test/a.mp3' }] } });
  });

  it('only honours reject:"busy" — an arbitrary reason is dropped', () => {
    expect(parseTwimlNode({ reject: true, reason: 'busy' })).toEqual({ reject: true, reason: 'busy' });
    expect(parseTwimlNode({ reject: true, reason: 'whatever' })).toEqual({ reject: true });
  });
});

describe('ConversationRelay', () => {
  it('wraps the relay in <Connect>, which Twilio requires', () => {
    // A bare <ConversationRelay> is a document Twilio rejects mid-call, so the
    // wrapper is written by the renderer rather than left to the author.
    const xml = renderTwiml(parseTwimlNodes([
      { conversationRelay: { url: 'wss://ai.example.com/relay', welcomeGreeting: 'Hi, how can I help?' } },
    ]));
    expect(xml).toContain('<Connect><ConversationRelay');
    expect(xml).toContain('url="wss://ai.example.com/relay"');
    expect(xml).toContain('welcomeGreeting="Hi, how can I help?"');
    expect(xml).toContain('/></Connect>');
  });

  it('DROPS a relay whose socket is not wss:// rather than emitting one Twilio refuses', () => {
    // Twilio will not open a non-secure socket. Failing at author time degrades
    // the reply; failing at request time drops a call with a customer on it.
    expect(parseTwimlNodes([{ conversationRelay: { url: 'ws://ai.example.com/relay' } }])).toEqual([]);
    expect(parseTwimlNodes([{ conversationRelay: { url: 'https://ai.example.com/relay' } }])).toEqual([]);
    expect(parseTwimlNodes([{ conversationRelay: {} }])).toEqual([]);
  });

  it('carries the voice/language/interruption options through', () => {
    const xml = renderTwiml(parseTwimlNodes([
      { conversationRelay: { url: 'wss://a.example.com/r', voice: 'en-US-Journey-O', language: 'en-US', interruptible: true, dtmfDetection: true } },
    ]));
    expect(xml).toContain('voice="en-US-Journey-O"');
    expect(xml).toContain('language="en-US"');
    expect(xml).toContain('interruptible="true"');
    expect(xml).toContain('dtmfDetection="true"');
  });

  it('escapes a greeting that contains XML metacharacters', () => {
    const xml = renderTwiml(parseTwimlNodes([
      { conversationRelay: { url: 'wss://a.example.com/r', welcomeGreeting: 'Tom & "Jerry" <hi>' } },
    ]));
    expect(xml).toContain('Tom &amp; &quot;Jerry&quot; &lt;hi&gt;');
  });
});
