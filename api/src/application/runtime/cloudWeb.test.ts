/**
 * The `web` capability's two pure halves. `classifyWebEgress` is the SSRF gate on an
 * agent-supplied URL — the security-relevant half, so the ranges it must refuse are
 * asserted explicitly; `htmlToText` is the token-saving half.
 */
import { describe, expect, it } from 'vitest';
import { classifyWebEgress, htmlToText } from './cloudWeb';

describe('classifyWebEgress', () => {
  it('allows ordinary public http(s) URLs', () => {
    for (const u of [
      'https://example.com/docs/page',
      'http://example.com',
      'https://sub.domain.example.co.uk/a/b?c=d#e',
      'https://93.184.216.34/', // a public IP literal is fine
      'https://example.com:8443/path',
    ]) {
      expect(classifyWebEgress(u)).toBeNull();
    }
  });

  it('refuses non-http(s) schemes', () => {
    for (const u of ['file:///etc/passwd', 'ftp://example.com', 'data:text/html,hi', 'javascript:alert(1)']) {
      expect(classifyWebEgress(u)).toMatch(/not allowed|not a valid/);
    }
  });

  it('refuses loopback + internal hostnames', () => {
    for (const u of [
      'http://localhost/',
      'http://localhost:8080/admin',
      'http://db.internal/',
      'http://printer.local/',
      'http://metadata.google.internal/computeMetadata/v1/',
    ]) {
      expect(classifyWebEgress(u)).toBeTruthy();
    }
  });

  it('refuses every private / loopback / link-local IPv4 range', () => {
    for (const host of [
      '127.0.0.1', '127.1.2.3',       // loopback
      '10.0.0.1', '10.255.255.255',   // RFC1918 /8
      '172.16.0.1', '172.31.255.1',   // RFC1918 /12
      '192.168.1.1',                  // RFC1918 /16
      '169.254.169.254',              // cloud metadata — the one that matters most
      '0.0.0.0',                      // this-network
      '100.64.0.1',                   // CGNAT
      '198.18.0.1',                   // benchmarking
      '224.0.0.1', '255.255.255.255', // multicast / broadcast
    ]) {
      expect(classifyWebEgress(`http://${host}/`), host).toBeTruthy();
    }
  });

  it('allows public IPv4 just outside the blocked ranges (no over-blocking)', () => {
    for (const host of ['172.15.0.1', '172.32.0.1', '11.0.0.1', '192.167.1.1', '100.63.0.1']) {
      expect(classifyWebEgress(`http://${host}/`), host).toBeNull();
    }
  });

  it('refuses IPv6 loopback, unique-local and link-local', () => {
    for (const host of ['[::1]', '[fc00::1]', '[fd12:3456::1]', '[fe80::1]']) {
      expect(classifyWebEgress(`http://${host}/`), host).toBeTruthy();
    }
  });

  it('refuses an IPv4-mapped IPv6 address that wraps a private address', () => {
    expect(classifyWebEgress('http://[::ffff:169.254.169.254]/')).toBeTruthy();
    expect(classifyWebEgress('http://[::ffff:10.0.0.1]/')).toBeTruthy();
  });

  it('is not fooled by a trailing dot or uppercase host', () => {
    expect(classifyWebEgress('http://LOCALHOST./')).toBeTruthy();
    expect(classifyWebEgress('http://127.0.0.1./')).toBeTruthy();
  });

  it('refuses garbage that is not an absolute URL', () => {
    for (const u of ['', 'not a url', '/relative/path', 'example.com']) {
      expect(classifyWebEgress(u)).toBeTruthy();
    }
  });
});

describe('htmlToText', () => {
  it('drops script/style content entirely', () => {
    const out = htmlToText('<p>Keep</p><script>var secret = 1;</script><style>.a{color:red}</style>');
    expect(out).toContain('Keep');
    expect(out).not.toContain('secret');
    expect(out).not.toContain('color:red');
  });

  it('turns block boundaries into newlines so paragraphs stay separated', () => {
    expect(htmlToText('<p>One</p><p>Two</p>')).toBe('One\n\nTwo');
    expect(htmlToText('<li>a</li><li>b</li>')).toBe('a\n\nb');
  });

  it('decodes the common entities', () => {
    expect(htmlToText('<p>a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;&nbsp;f</p>')).toBe('a & b <c> "d" \'e\' f');
  });

  it('strips comments and collapses runaway whitespace', () => {
    expect(htmlToText('<!-- hidden --><div>  lots    of\n\n\n   space  </div>')).toBe('lots of space');
  });
});
