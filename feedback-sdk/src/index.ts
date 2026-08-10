/**
 * BuilderforceFeedback — the embeddable product-feedback widget.
 *
 * Drops a small tab onto the edge of any page; clicking it slides out a panel
 * that files a feature request, bug report or idea against the project behind
 * the ingest key. Requests land in that project's backlog as EXTERNAL REQUESTS
 * which no agent may execute until a human approves them.
 *
 *   <script src="https://unpkg.com/@seanhogg/builderforce-feedback"></script>
 *   <script>BuilderforceFeedback.init({ key: 'bff_…' });</script>
 *
 * Everything renders inside a shadow root with its own reset, so the widget can
 * neither inherit nor leak page styles. No dependencies, no framework.
 */

import {
  buildPayload, kindLabel, normalizeEndpoint, postFeedback, resolveKinds, resolveLabels,
} from './core';
import type { FeedbackKind, FeedbackLabels, FeedbackWidgetOptions } from './types';

export * from './types';
export {
  buildPayload, postFeedback, normalizeEndpoint, resolveKinds, resolveLabels, kindLabel,
  DEFAULT_ENDPOINT, DEFAULT_LABELS, ALL_KINDS,
} from './core';

const HOST_ID = 'builderforce-feedback-root';

/** Panel + tab styles. Scoped to the shadow root, so no host-page collisions. */
function styles(accent: string, side: 'left' | 'right'): string {
  const edge = side === 'right' ? 'right' : 'left';
  const opposite = side === 'right' ? 'left' : 'right';
  return `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }
  .tab {
    position: fixed; ${edge}: 0; top: 50%; transform: translateY(-50%);
    z-index: 2147483000;
    writing-mode: vertical-rl; ${side === 'right' ? '' : 'rotate: 180deg;'}
    padding: 16px 8px; border: none; cursor: pointer;
    background: ${accent}; color: #fff;
    font: 600 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
    letter-spacing: .04em;
    border-radius: ${side === 'right' ? '8px 0 0 8px' : '0 8px 8px 0'};
    box-shadow: 0 2px 12px rgba(0,0,0,.24);
  }
  .tab:hover { filter: brightness(1.08); }
  .tab:focus-visible { outline: 3px solid ${accent}; outline-offset: 3px; }
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 2147483001; }
  .panel {
    position: fixed; top: 0; bottom: 0; ${edge}: 0; width: min(420px, 100vw);
    z-index: 2147483002; display: flex; flex-direction: column;
    background: var(--bff-bg); color: var(--bff-fg);
    border-${opposite}: 1px solid var(--bff-border);
    box-shadow: 0 0 32px rgba(0,0,0,.28);
    font: 400 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .head { display: flex; align-items: center; gap: 12px; padding: 16px 18px; border-bottom: 1px solid var(--bff-border); }
  .head h2 { margin: 0; font-size: 16px; font-weight: 700; flex: 1; }
  .x { border: 1px solid var(--bff-border); background: var(--bff-subtle); color: inherit;
       width: 32px; height: 32px; border-radius: 8px; cursor: pointer; font-size: 16px; line-height: 1; }
  .body { flex: 1; overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 14px; }
  .intro { margin: 0; font-size: 13px; color: var(--bff-muted); }
  label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 600; color: var(--bff-muted); }
  input, textarea, select {
    font: inherit; width: 100%; padding: 9px 11px; border-radius: 8px;
    border: 1px solid var(--bff-border); background: var(--bff-subtle); color: var(--bff-fg);
  }
  input:focus, textarea:focus, select:focus { outline: 2px solid ${accent}; outline-offset: 1px; }
  textarea { min-height: 128px; resize: vertical; }
  .kinds { display: flex; flex-wrap: wrap; gap: 8px; }
  .kind {
    flex: 1 1 auto; padding: 8px 10px; border-radius: 8px; cursor: pointer;
    border: 1px solid var(--bff-border); background: var(--bff-subtle); color: var(--bff-fg);
    font: 600 12px/1.2 inherit; white-space: nowrap;
  }
  .kind[aria-pressed="true"] { border-color: ${accent}; background: ${accent}; color: #fff; }
  .send {
    padding: 11px 16px; border: none; border-radius: 8px; cursor: pointer;
    background: ${accent}; color: #fff; font: 600 14px/1 inherit;
  }
  .send[disabled] { opacity: .6; cursor: default; }
  .err { margin: 0; font-size: 13px; color: var(--bff-danger); }
  .done { text-align: center; padding: 32px 8px; display: flex; flex-direction: column; gap: 10px; align-items: center; }
  .done h3 { margin: 0; font-size: 17px; }
  .done p { margin: 0; font-size: 13px; color: var(--bff-muted); }
  .link { background: none; border: none; color: ${accent}; cursor: pointer; font: 600 13px/1 inherit; text-decoration: underline; }
  @media (max-width: 480px) { .panel { width: 100vw; } .tab { padding: 12px 7px; font-size: 12px; } }
  @media (prefers-reduced-motion: no-preference) { .panel { animation: bff-in .18s ease-out; } }
  @keyframes bff-in { from { transform: translateX(${side === 'right' ? '100%' : '-100%'}); } to { transform: none; } }
  `;
}

/** Light/dark palettes. 'auto' follows the host page's prefers-color-scheme. */
function palette(theme: 'light' | 'dark' | 'auto'): string {
  const light = `--bff-bg:#ffffff;--bff-fg:#14161a;--bff-muted:#5b6472;--bff-border:#dde1e7;--bff-subtle:#f5f7fa;--bff-danger:#c02626;`;
  const dark = `--bff-bg:#15181d;--bff-fg:#eef1f5;--bff-muted:#98a2b3;--bff-border:#2c313a;--bff-subtle:#1d222a;--bff-danger:#ff6b6b;`;
  if (theme === 'light') return `:host{${light}}`;
  if (theme === 'dark') return `:host{${dark}}`;
  return `:host{${light}} @media (prefers-color-scheme: dark){:host{${dark}}}`;
}

/** Escape text interpolated into the widget's markup. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch
  ));
}

export class FeedbackWidget {
  private readonly opts: FeedbackWidgetOptions;
  private readonly labels: FeedbackLabels;
  private readonly kinds: FeedbackKind[];
  private readonly endpoint: string;
  private root: ShadowRoot | null = null;
  private host: HTMLElement | null = null;
  private open = false;
  private sending = false;
  private done = false;
  private error: string | null = null;
  private draft = { kind: 'feature' as FeedbackKind, title: '', body: '', email: '' };

  constructor(opts: FeedbackWidgetOptions) {
    this.opts = opts;
    this.labels = resolveLabels(opts.labels);
    this.kinds = resolveKinds(opts.kinds);
    this.endpoint = normalizeEndpoint(opts.endpoint);
    this.draft.kind = this.kinds[0]!;
  }

  /** Create the shadow host and paint the launcher tab. Idempotent. */
  mount(): void {
    if (this.root || typeof document === 'undefined') return;
    const existing = document.getElementById(HOST_ID);
    if (existing) existing.remove(); // a second init replaces the first
    const host = document.createElement('div');
    host.id = HOST_ID;
    document.body.appendChild(host);
    this.host = host;
    this.root = host.attachShadow({ mode: 'open' });
    document.addEventListener('keydown', this.onKeydown);
    this.render();
  }

  /** Remove the widget entirely and release its listeners. */
  destroy(): void {
    document.removeEventListener('keydown', this.onKeydown);
    this.host?.remove();
    this.host = null;
    this.root = null;
  }

  openPanel(): void { this.open = true; this.render(); this.focusFirstField(); }
  closePanel(): void { this.open = false; this.error = null; this.render(); }

  private onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.open) this.closePanel();
  };

  private focusFirstField(): void {
    const el = this.root?.querySelector<HTMLTextAreaElement>('#bff-body');
    // Defer so the element exists after the render that this follows.
    if (el) setTimeout(() => el.focus(), 0);
  }

  private async submit(): Promise<void> {
    if (this.sending) return;
    const payload = buildPayload(this.draft, this.opts, {
      url: typeof location !== 'undefined' ? location.href : undefined,
    });
    if ('error' in payload) { this.error = this.labels.errorRequired; this.render(); return; }

    this.sending = true; this.error = null; this.render();
    const outcome = await postFeedback(this.endpoint, this.opts.key, payload);
    this.sending = false;

    if (outcome.ok) {
      this.done = true;
      this.draft = { kind: this.kinds[0]!, title: '', body: '', email: '' };
      this.opts.onSubmit?.({ submissionId: outcome.submissionId ?? '', deduped: !!outcome.deduped });
    } else {
      this.error = outcome.rateLimited ? this.labels.errorRateLimited : this.labels.errorGeneric;
    }
    this.render();
  }

  private render(): void {
    if (!this.root) return;
    const l = this.labels;
    const accent = this.opts.accent ?? '#f4726e';
    const side = this.opts.side ?? 'right';
    const showTab = this.opts.showTab !== false;

    this.root.innerHTML = `
      <style>${palette(this.opts.theme ?? 'auto')}${styles(accent, side)}</style>
      ${showTab ? `<button class="tab" part="tab" aria-haspopup="dialog" aria-expanded="${this.open}">${esc(l.tab)}</button>` : ''}
      ${this.open ? `
        <div class="overlay" part="overlay"></div>
        <section class="panel" role="dialog" aria-modal="true" aria-label="${esc(l.title)}">
          <div class="head">
            <h2>${esc(l.title)}</h2>
            <button class="x" aria-label="${esc(l.close)}">&times;</button>
          </div>
          <div class="body">${this.done ? this.doneMarkup() : this.formMarkup()}</div>
        </section>` : ''}
    `;
    this.bind();
  }

  private formMarkup(): string {
    const l = this.labels;
    const d = this.draft;
    return `
      <p class="intro">${esc(l.intro)}</p>
      <div class="kinds" role="group" aria-label="${esc(l.titleField)}">
        ${this.kinds.map((k) => `
          <button class="kind" type="button" data-kind="${k}" aria-pressed="${d.kind === k}">${esc(kindLabel(k, l))}</button>
        `).join('')}
      </div>
      <label>${esc(l.titleField)}
        <input id="bff-title" type="text" maxlength="300" placeholder="${esc(l.titlePlaceholder)}" value="${esc(d.title)}">
      </label>
      <label>${esc(l.bodyField)}
        <textarea id="bff-body" maxlength="10000" placeholder="${esc(l.bodyPlaceholder)}">${esc(d.body)}</textarea>
      </label>
      ${this.opts.collectEmail === false ? '' : `
        <label>${esc(l.emailField)}
          <input id="bff-email" type="email" maxlength="255" placeholder="${esc(l.emailPlaceholder)}" value="${esc(d.email)}">
        </label>`}
      ${this.error ? `<p class="err" role="alert">${esc(this.error)}</p>` : ''}
      <button class="send" type="button" ${this.sending ? 'disabled' : ''}>
        ${esc(this.sending ? l.submitting : l.submit)}
      </button>
    `;
  }

  private doneMarkup(): string {
    const l = this.labels;
    return `
      <div class="done">
        <h3>${esc(l.successTitle)}</h3>
        <p>${esc(l.successBody)}</p>
        <button class="link" type="button" data-again>${esc(l.another)}</button>
      </div>
    `;
  }

  private bind(): void {
    const r = this.root;
    if (!r) return;
    r.querySelector('.tab')?.addEventListener('click', () => (this.open ? this.closePanel() : this.openPanel()));
    r.querySelector('.overlay')?.addEventListener('click', () => this.closePanel());
    r.querySelector('.x')?.addEventListener('click', () => this.closePanel());
    r.querySelector('.send')?.addEventListener('click', () => void this.submit());
    r.querySelector('[data-again]')?.addEventListener('click', () => { this.done = false; this.render(); this.focusFirstField(); });

    r.querySelectorAll<HTMLButtonElement>('.kind').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.draft.kind = (btn.dataset.kind as FeedbackKind) ?? this.draft.kind;
        this.render();
      });
    });

    // Keep the draft in sync on input so a re-render (kind switch, error) never
    // discards what the user has already typed.
    const bindField = (id: string, field: 'title' | 'body' | 'email') => {
      r.querySelector<HTMLInputElement>(`#${id}`)?.addEventListener('input', (e) => {
        this.draft[field] = (e.target as HTMLInputElement).value;
      });
    };
    bindField('bff-title', 'title');
    bindField('bff-body', 'body');
    bindField('bff-email', 'email');
  }
}

let instance: FeedbackWidget | null = null;

/** Mount the widget. Calling init again replaces the previous instance. */
export function init(opts: FeedbackWidgetOptions): FeedbackWidget {
  if (!opts?.key) throw new Error('BuilderforceFeedback.init: `key` is required');
  instance?.destroy();
  instance = new FeedbackWidget(opts);
  instance.mount();
  return instance;
}

/** Open the panel programmatically (e.g. from your own "Feedback" menu item). */
export function open(): void { instance?.openPanel(); }
/** Close the panel programmatically. */
export function close(): void { instance?.closePanel(); }
/** Remove the widget from the page. */
export function destroy(): void { instance?.destroy(); instance = null; }
