import type { ReactNode } from 'react';

/**
 * The shared frame for a PUBLIC per-entity detail page — one published skill,
 * persona, prompt, agent or creation listing.
 *
 * These pages all render the same shape: an eyebrow naming the catalog, the
 * entity's name as the page's only `h1`, a meta row of small facts, a lede, its
 * tags, a CTA row, then sections. `/marketplace/[slug]` grew that shape first and
 * carried its own `.mps-*` stylesheet; adding four more entity pages would have
 * meant five copies of the same forty lines of CSS, each free to drift on the
 * gutter, the type scale or the dark-mode token. So the shape is written once
 * here and `/marketplace/[slug]` was migrated onto it in the same pass.
 *
 * Deliberately NOT a client component: every consumer is a server component that
 * renders this around a small client island, and the frame itself has no state.
 *
 * Theming/responsiveness: colour, radius and type come from CSS variables only,
 * the column is `var(--marketing-max)` with the fluid `var(--marketing-gutter)`,
 * and every wide child (the fact grid, the prompt body) is allowed to scroll
 * inside itself so the page body never scrolls sideways at 360px.
 */

export interface PublicDetailLayoutProps {
  /** Small uppercase label naming the catalog this entity belongs to. */
  eyebrow: string;
  /** The entity name — rendered as the page's single `h1`. */
  title: string;
  /** Optional leading glyph (a built-in skill's emoji, a persona's initial). */
  icon?: ReactNode;
  /** Small facts shown under the title; separators are inserted automatically. */
  meta?: ReactNode[];
  /** The one-paragraph description a crawler and a reader both lead with. */
  lede?: string | null;
  tags?: string[];
  /** Buttons and links — usually a server `<Link>` plus a client island. */
  actions?: ReactNode;
  children?: ReactNode;
}

/** The shared stylesheet. Rendered once per page by {@link PublicDetailLayout}. */
function PublicDetailStyles() {
  return (
    <style>{`
      .pdl { position: relative; z-index: 1; min-height: 100vh; display: flex; flex-direction: column; }
      .pdl-main { max-width: var(--marketing-max); margin: 0 auto; width: 100%;
                  padding: 44px var(--marketing-gutter) 48px; }
      .pdl-back { display: inline-block; font-size: var(--font-size-small); color: var(--coral-bright);
                  text-decoration: none; margin-bottom: 18px; }
      .pdl-back:hover { text-decoration: underline; }
      .pdl-eyebrow { font-family: var(--font-display); font-size: var(--font-size-eyebrow); font-weight: 600;
                     letter-spacing: 0.16em; text-transform: uppercase; color: var(--coral-bright);
                     margin-bottom: 12px; }
      .pdl-title { font-family: var(--font-display); font-weight: 700; letter-spacing: -0.03em; line-height: 1.1;
                   font-size: var(--font-size-page-title); color: var(--text-primary); margin: 0 0 12px;
                   display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
                   overflow-wrap: anywhere; }
      .pdl-meta { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; color: var(--text-secondary);
                  font-size: var(--font-size-small); margin: 0 0 18px; }
      .pdl-meta-sep { color: var(--border-subtle); }
      .pdl-lede { font-size: var(--font-size-lede); color: var(--text-primary); line-height: 1.7; margin: 0 0 18px;
                  overflow-wrap: anywhere; }
      .pdl-tags { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 22px; }
      .pdl-tag { font-size: var(--font-size-eyebrow); font-weight: 600; color: var(--text-secondary);
                 border: 1px solid var(--border-subtle); border-radius: var(--radius-full); padding: 4px 12px; }
      .pdl-actions { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin: 4px 0 28px; }
      .pdl-btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 22px;
                 border-radius: var(--radius-lg); font-weight: 600; font-size: var(--font-size-body);
                 text-decoration: none; border: 1px solid transparent; cursor: pointer; font-family: inherit; }
      .pdl-btn[disabled] { opacity: 0.55; cursor: not-allowed; }
      .pdl-btn-primary { background: linear-gradient(135deg, var(--coral-bright), var(--error));
                         color: var(--text-on-accent); }
      .pdl-btn-ghost { background: var(--surface-card); border-color: var(--border-subtle); color: var(--text-primary); }
      .pdl-h2 { font-family: var(--font-display); font-weight: 700; font-size: var(--font-size-card-title);
                color: var(--text-primary); margin: 28px 0 12px; }
      .pdl-card { background: var(--surface-card); border: 1px solid var(--border-subtle);
                  border-radius: var(--radius-lg); padding: 20px 22px; color: var(--text-primary);
                  line-height: 1.7; font-size: var(--font-size-body); }
      .pdl-prose { white-space: pre-wrap; overflow-wrap: anywhere; }
      .pdl-facts { display: grid; gap: 14px; }
      .pdl-fact-label { font-size: var(--font-size-eyebrow); font-weight: 600; color: var(--text-secondary);
                        text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
      .pdl-fact-value { font-size: var(--font-size-body); color: var(--text-primary); overflow-wrap: anywhere; }
      .pdl-code { display: inline-block; max-width: 100%; overflow-x: auto; background: var(--surface-2);
                  border-radius: var(--radius-sm); padding: 2px 8px; font-family: var(--font-mono);
                  font-size: var(--font-size-small); color: var(--text-primary); }
      @media (max-width: 480px) {
        .pdl-main { padding-top: 28px; }
        .pdl-actions .pdl-btn { flex: 1 1 100%; justify-content: center; }
      }
    `}</style>
  );
}

export default function PublicDetailLayout({
  eyebrow, title, icon, meta, lede, tags, actions, children,
}: PublicDetailLayoutProps) {
  // Falsy meta entries are dropped BEFORE the separators are woven in, so an
  // absent author or version never leaves a stranded interpunct.
  const metaItems = (meta ?? []).filter(Boolean);
  return (
    <>
      <PublicDetailStyles />
      <main className="pdl">
        <div className="pdl-main">
          <div className="pdl-eyebrow">{eyebrow}</div>
          <h1 className="pdl-title">
            {icon ? <span aria-hidden="true">{icon}</span> : null}
            {title}
          </h1>
          {metaItems.length ? (
            <div className="pdl-meta">
              {metaItems.map((item, i) => (
                <span key={i} style={{ display: 'contents' }}>
                  {i > 0 ? <span className="pdl-meta-sep" aria-hidden="true">·</span> : null}
                  <span>{item}</span>
                </span>
              ))}
            </div>
          ) : null}
          {lede ? <p className="pdl-lede">{lede}</p> : null}
          {tags && tags.length ? (
            <div className="pdl-tags">
              {tags.map((tag) => <span className="pdl-tag" key={tag}>{tag}</span>)}
            </div>
          ) : null}
          {actions ? <div className="pdl-actions">{actions}</div> : null}
          {children}
        </div>
        {/* Footer is the canonical <AppFooter variant="full"> rendered by PublicShell. */}
      </main>
    </>
  );
}

/** An `h2` + card section. The one section shape every detail page uses. */
export function PublicDetailSection({
  heading, prose, children,
}: { heading: string; prose?: boolean; children: ReactNode }) {
  return (
    <>
      <h2 className="pdl-h2">{heading}</h2>
      <div className={`pdl-card${prose ? ' pdl-prose' : ''}`}>{children}</div>
    </>
  );
}

/** A label/value row inside a {@link PublicDetailSection} fact grid. */
export function PublicDetailFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="pdl-fact-label">{label}</div>
      <div className="pdl-fact-value">{children}</div>
    </div>
  );
}

/** The grid that holds {@link PublicDetailFact} rows. */
export function PublicDetailFacts({ children }: { children: ReactNode }) {
  return <div className="pdl-facts">{children}</div>;
}
