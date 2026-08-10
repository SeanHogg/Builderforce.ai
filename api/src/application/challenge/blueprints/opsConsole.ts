/**
 * The operations console every blueprint ships.
 *
 * Each blueprint needs the same page: "here are the URLs to paste into the
 * provider's dashboard, here is whether each one is actually serving, and here is
 * what you have consumed against your allowance". Writing that per blueprint
 * produced three copies of the same 200 lines of HTML differing only in their
 * labels — so it is generated from a description instead.
 *
 * ── WHY A SINGLE DEPENDENCY-FREE FILE ───────────────────────────────────────
 * It is published to the project's static site. A build step between "the system
 * works" and "I can show someone" is a step that breaks on demo day.
 *
 * ── WHY IT DECLARES BOTH THEMES ITSELF ──────────────────────────────────────
 * This is served from the project's own subdomain and has no access to the app's
 * theme tokens, so light and dark are declared here rather than inherited.
 */

export interface ConsoleMeter {
  label: string;
  /** Included allowance the meter counts against. */
  allowance: number;
}

export interface ConsoleRoute {
  label: string;
  /** Handler route, as it appears in the spec (`/sms`). */
  path: string;
}

export interface OpsConsoleOptions {
  title: string;
  subtitle: string;
  /** Column header over the URL column — "Point Twilio at", "Point Stripe at". */
  targetLabel: string;
  routes: readonly ConsoleRoute[];
  /** Omit or leave empty for a system with no metered allowance. */
  meters?: readonly ConsoleMeter[];
}

/** HTML-escape a value going into generated markup. `&` first, or the escapes
 *  of the later replacements would themselves be escaped. */
const esc = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderOpsConsole(options: OpsConsoleOptions): string {
  const meters = options.meters ?? [];
  const allowance = Object.fromEntries(meters.map((m) => [m.label, m.allowance]));
  const routes = options.routes.map((r) => [r.label, r.path]);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(options.title)}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f7f9; --surface: #ffffff; --text: #14161a; --muted: #5c6470;
    --border: #dfe3e8; --accent: #2f6fed; --ok: #167a4a; --warn: #9a6200; --bad: #b3261e;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0e1116; --surface: #161a21; --text: #e8eaed; --muted: #9aa3ae;
      --border: #262c36; --accent: #6f9bff; --ok: #4ade80; --warn: #fbbf24; --bad: #f87171;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
         font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: clamp(16px, 4vw, 40px); }
  h1 { font-size: clamp(20px, 4vw, 30px); margin: 0 0 6px; }
  .sub { color: var(--muted); margin: 0 0 28px; }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 18px; }
  .card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em;
             color: var(--muted); margin: 0 0 12px; }
  .num { font-size: clamp(24px, 5vw, 34px); font-weight: 700; }
  .cap { color: var(--muted); font-size: 13px; }
  .bar { height: 6px; border-radius: 3px; background: var(--border); margin-top: 10px; overflow: hidden; }
  .bar > i { display: block; height: 100%; background: var(--accent); }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  code { background: var(--bg); border: 1px solid var(--border); border-radius: 5px;
         padding: 2px 6px; font-size: 12.5px; word-break: break-all; }
  .scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .pill.ok { background: color-mix(in srgb, var(--ok) 16%, transparent); color: var(--ok); }
  .pill.bad { background: color-mix(in srgb, var(--bad) 16%, transparent); color: var(--bad); }
  section { margin-top: 28px; }
  h2.section { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 0 0 12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(options.title)}</h1>
  <p class="sub">${esc(options.subtitle)}</p>

  <section class="grid" id="meters"></section>

  <section>
    <h2 class="section">Webhook endpoints</h2>
    <div class="card scroll">
      <table>
        <thead><tr><th>What</th><th>${esc(options.targetLabel)}</th><th>Status</th></tr></thead>
        <tbody id="endpoints"></tbody>
      </table>
    </div>
  </section>
</div>

<script>
  // Included allowances. Edit these if your plan changes.
  var ALLOWANCE = ${JSON.stringify(allowance)};

  // The ingress this console belongs to. Replaced at build time by the platform;
  // falls back to empty for local preview, which renders the URLs as unset rather
  // than as a wrong address someone might paste into a provider console.
  var INGRESS = window.__INGRESS_URL__ || '';

  var ROUTES = ${JSON.stringify(routes)};

  function meters() {
    var host = document.getElementById('meters');
    var keys = Object.keys(ALLOWANCE);
    if (!keys.length) { host.remove(); return; }
    var used = JSON.parse(localStorage.getItem('bf.usage') || '{}');
    host.innerHTML = keys.map(function (k) {
      var cap = ALLOWANCE[k], n = used[k] || 0, pct = Math.min(100, Math.round((n / cap) * 100));
      return '<div class="card"><h2>' + k + '</h2>' +
        '<div class="num">' + n + '</div>' +
        '<div class="cap">of ' + cap + ' included</div>' +
        '<div class="bar"><i style="width:' + pct + '%"></i></div></div>';
    }).join('');
  }

  function endpoints() {
    document.getElementById('endpoints').innerHTML = ROUTES.map(function (r) {
      return '<tr><td>' + r[0] + '</td><td><code>' + (INGRESS || '(ingress URL not set)') + r[1] +
        '</code></td><td><span class="pill ok" data-route="' + r[1] + '">checking…</span></td></tr>';
    }).join('');

    if (!INGRESS) return;
    // The ingress root reports which handlers are actually serving, so this says
    // "live" only when the platform agrees — not merely when the file was written.
    fetch(INGRESS).then(function (r) { return r.json(); }).then(function (data) {
      var live = {};
      (data.handlers || []).forEach(function (h) { live[h.route] = true; });
      document.querySelectorAll('[data-route]').forEach(function (el) {
        var ok = live[el.getAttribute('data-route')];
        el.className = 'pill ' + (ok ? 'ok' : 'bad');
        el.textContent = ok ? 'live' : 'no handler';
      });
    }).catch(function () {
      document.querySelectorAll('[data-route]').forEach(function (el) {
        el.className = 'pill bad'; el.textContent = 'unreachable';
      });
    });
  }

  meters();
  endpoints();
</script>
</body>
</html>
`;
}
