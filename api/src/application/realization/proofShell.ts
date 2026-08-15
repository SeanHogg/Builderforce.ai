/**
 * The page shell every proof ships.
 *
 * Eight targets each needed the same 120 lines of CSS: a light/dark palette, a
 * responsive card grid, a table that scrolls instead of widening a phone, and a
 * type scale that does not need a font download. Writing it per target produced
 * copies that differed only in their headings — and would have diverged the first
 * time one of them was improved.
 *
 * ── WHY A SINGLE DEPENDENCY-FREE FILE ───────────────────────────────────────
 * These are published to the project's own static site. A build step between
 * "the proof exists" and "I can show someone" is a step that breaks on demo day.
 *
 * ── WHY IT DECLARES BOTH THEMES ITSELF ──────────────────────────────────────
 * It is served from the customer's subdomain and has no access to the app's
 * theme tokens, so light and dark are declared here rather than inherited. The
 * same reason `renderOpsConsole` does it — and the two are deliberately not
 * merged: that one is an operator's endpoint list with live status, this one is a
 * document shell. Sharing the palette would couple every proof page to the
 * layout of a webhook table.
 */

/** HTML-escape a value going into generated markup. `&` first, or the escapes
 *  of the later replacements would themselves be escaped. */
export const esc = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface ProofShellOptions {
  title: string;
  /** Sits under the heading — one sentence on what this page is for. */
  subtitle: string;
  /** Small label above the heading, e.g. "Smoke test". */
  eyebrow?: string;
  /** Page body markup, inside the centred wrapper. */
  body: string;
  /** Script appended before `</body>`. No modules, no imports. */
  script?: string;
  /** Extra rules appended to the stylesheet. */
  styles?: string;
  /** Widest the content gets. Narrow for a landing page, wide for a console. */
  maxWidth?: number;
}

/**
 * The shared palette and layout.
 *
 * Exported separately so a target that needs its own document structure (a
 * full-bleed demo reel, say) can still be the same colour as its siblings.
 */
export const PROOF_STYLES = `
  :root {
    color-scheme: light dark;
    --bg: #f6f7f9; --surface: #ffffff; --sunken: #eef0f4; --text: #14161a;
    --muted: #5c6470; --border: #dfe3e8; --accent: #2f6fed; --on-accent: #ffffff;
    --ok: #167a4a; --warn: #9a6200; --bad: #b3261e;
    --radius: 12px; --shadow: 0 1px 2px rgba(16, 24, 40, .06), 0 1px 3px rgba(16, 24, 40, .1);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0e1116; --surface: #161a21; --sunken: #1c212a; --text: #e8eaed;
      --muted: #9aa3ae; --border: #262c36; --accent: #6f9bff; --on-accent: #0e1116;
      --ok: #4ade80; --warn: #fbbf24; --bad: #f87171;
      --shadow: 0 1px 2px rgba(0, 0, 0, .4);
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
         font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         -webkit-text-size-adjust: 100%; }
  .wrap { margin: 0 auto; padding: clamp(16px, 4vw, 48px); }
  .eyebrow { text-transform: uppercase; letter-spacing: .08em; font-size: 12px;
             font-weight: 700; color: var(--accent); margin: 0 0 8px; }
  h1 { font-size: clamp(24px, 5vw, 38px); line-height: 1.2; margin: 0 0 10px; letter-spacing: -0.01em; }
  h2 { font-size: clamp(18px, 3vw, 22px); margin: 0 0 10px; }
  h3 { font-size: 15px; margin: 0 0 6px; }
  .sub { color: var(--muted); margin: 0 0 32px; font-size: clamp(15px, 2.2vw, 18px); }
  .card { background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--radius); padding: clamp(16px, 3vw, 24px); box-shadow: var(--shadow); }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); }
  .stack { display: grid; gap: 16px; }
  .muted { color: var(--muted); }
  .num { font-size: clamp(28px, 6vw, 40px); font-weight: 700; line-height: 1.1; }
  .label { font-size: 12px; text-transform: uppercase; letter-spacing: .05em;
           color: var(--muted); font-weight: 600; }
  .bar { height: 8px; border-radius: 4px; background: var(--sunken); overflow: hidden; margin-top: 12px; }
  .bar > i { display: block; height: 100%; background: var(--accent); transition: width .4s ease; }
  .pill { display: inline-block; padding: 3px 10px; border-radius: 999px;
          font-size: 12px; font-weight: 600; border: 1px solid var(--border); }
  .pill.ok { background: color-mix(in srgb, var(--ok) 16%, transparent); color: var(--ok); border-color: transparent; }
  .pill.warn { background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn); border-color: transparent; }
  .pill.bad { background: color-mix(in srgb, var(--bad) 16%, transparent); color: var(--bad); border-color: transparent; }
  button, .btn { font: inherit; font-weight: 600; padding: 12px 20px; border-radius: 10px;
                 border: 1px solid var(--accent); background: var(--accent); color: var(--on-accent);
                 cursor: pointer; text-decoration: none; display: inline-block; }
  button.ghost, .btn.ghost { background: transparent; color: var(--text); border-color: var(--border); }
  button:disabled { opacity: .55; cursor: not-allowed; }
  input, textarea, select { font: inherit; width: 100%; padding: 12px 14px; border-radius: 10px;
                            border: 1px solid var(--border); background: var(--sunken); color: var(--text); }
  /* A native option list inherits neither the page background nor its colour in
     every browser, so it gets both explicitly or it is white-on-white in dark. */
  option { background: var(--surface); color: var(--text); }
  label { display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px; }
  form .field { margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px;
                background: var(--sunken); border: 1px solid var(--border); border-radius: 6px;
                padding: 2px 6px; word-break: break-all; }
  ul.checks { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
  ul.checks li { padding-left: 26px; position: relative; }
  ul.checks li::before { content: "○"; position: absolute; left: 4px; color: var(--accent); font-weight: 700; }
  section { margin-top: 32px; }
  footer { margin-top: 48px; padding-top: 20px; border-top: 1px solid var(--border);
           color: var(--muted); font-size: 13px; }
`;

export function renderProofShell(options: ProofShellOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(options.title)}</title>
<style>${PROOF_STYLES}${options.styles ?? ''}
  .wrap { max-width: ${options.maxWidth ?? 960}px; }
</style>
</head>
<body>
<div class="wrap">
${options.eyebrow ? `  <p class="eyebrow">${esc(options.eyebrow)}</p>\n` : ''}  <h1>${esc(options.title)}</h1>
  <p class="sub">${esc(options.subtitle)}</p>
${options.body}
</div>
${options.script ? `<script>\n${options.script}\n</script>\n` : ''}</body>
</html>
`;
}

/**
 * The one place a generated page learns its own backend address.
 *
 * `materializeChallenge` rewrites `window.__INGRESS_URL__ || ''` when it writes a
 * file, so every page must spell it EXACTLY that way. A page that wrote its own
 * variant silently kept the empty fallback and shipped a console that could
 * never reach its own handlers.
 */
export const INGRESS_EXPRESSION = "window.__INGRESS_URL__ || ''";

/** A `<script>` prelude binding `INGRESS` for a page that calls its handlers. */
export const INGRESS_PRELUDE = `  var INGRESS = ${INGRESS_EXPRESSION};`;
