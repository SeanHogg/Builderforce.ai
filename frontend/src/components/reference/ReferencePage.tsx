/**
 * THE reference-page layout (PRD 21 §11.4.5).
 *
 * A reference page is one component in two shells: an ordinary indexable page
 * signed out, the same component inside `ShellPanel` over a live board signed
 * in. That contract says nothing about *how* it is laid out — and so each one
 * laid itself out. `/soc2` shipped `.s2-*`, `/integrations` shipped `.intx-*`
 * and `/tools/<id>` shipped `.tref-*`: three private `<style>` blocks inside
 * three route files, declaring the same hero, band, card grid and button pair
 * at slightly different paddings, type scales and grid floors. Pages the PRD
 * calls one surface did not line up with each other.
 *
 * The house marketing kit — `.mk-*` in `globals.css`, already rendering
 * `/features`, `/media`, `/prompts`, `/marketplace` and the tools hub — is the
 * answer, and always was. This module is a thin vocabulary over it, NOT a
 * second one: it emits `.mk-*` and nothing else, so a change to the kit reaches
 * every reference page, and the kit gained exactly two rules for this
 * (`.mk-hero--center`, `.mk-code`) rather than a parallel namespace.
 *
 * Deliberately server-compatible — no hooks, no `'use client'`. `/soc2` and
 * `/integrations` are server components reading `getTranslations`, and a client
 * boundary here would drag both into the client bundle to render static markup.
 * `/tools/<id>`'s client page composes them just as happily.
 *
 * Sections take an `id` because those anchors ARE the panel's index rail — see
 * `ShellPanel`'s `ReferenceIndex`, fed either by the registry row's `sections`
 * (asserted by `check-destinations`) or by the page itself via
 * `lib/referenceChrome`.
 */

import Link from 'next/link';
import { ReferenceChrome } from './ReferenceChrome';
import type { ReferenceChromeSection } from '@/lib/referenceChrome';

/**
 * The root — and the one place a reference page declares what the panel should
 * call it and what its index rail lists.
 *
 * `sections` is the SAME array the page maps over to render its anchored bands,
 * so the rail cannot advertise a section the page stopped rendering. That used
 * to be a registry declaration checked at build time by `check-destinations`,
 * which worked for `/soc2` (five fixed sections) and could not work at all for
 * a page whose sections are data.
 */
export function ReferencePage({ title, sections, children }: {
  /** What the panel header calls this page. Omit to keep the registry's title. */
  title?: string;
  /** `{ id, label }` per anchored band, already localized. */
  sections?: ReferenceChromeSection[];
  children: React.ReactNode;
}) {
  return (
    <div className="mk">
      <ReferenceChrome {...(title ? { title } : {})} {...(sections ? { sections } : {})} />
      {children}
    </div>
  );
}

export interface ReferenceAction {
  href: string;
  label: string;
  /** `ghost` is the kit's secondary button. */
  variant?: 'solid' | 'ghost';
}

function ActionLink({ href, label, variant = 'solid' }: ReferenceAction) {
  const className = variant === 'ghost' ? 'mk-cta mk-cta--ghost' : 'mk-cta';
  // An in-page anchor is a scroll, not a navigation — inside the panel it must
  // not touch the board behind it, and `next/link` would treat it as a route.
  return href.startsWith('#')
    ? <a href={href} className={className}>{label}</a>
    : <Link href={href} className={className}>{label}</Link>;
}

/**
 * The centred hero. `.mk-hero` is the kit's two-column hero (a story beside an
 * overview card); a reference page has no companion column, so it takes the
 * `--center` modifier rather than a different hero.
 */
export function ReferenceHero({ eyebrow, mark, title, titleAccent, lede, actions = [] }: {
  eyebrow?: string;
  /** The destination's own icon, above the title. */
  mark?: React.ReactNode;
  title: string;
  /** A second clause, gradient-filled — the kit allows one gradient per page. */
  titleAccent?: string;
  lede: string;
  actions?: ReferenceAction[];
}) {
  return (
    <section className="mk-band mk-band--wash">
      <div className="mk-in">
        <div className="mk-hero mk-hero--center">
          <div>
            {eyebrow && <div className="mk-badges" style={{ justifyContent: 'center' }}><span className="mk-badge">{eyebrow}</span></div>}
            {mark && <span className="mk-hero__mark">{mark}</span>}
            <h1 className="mk-h1">
              {title}
              {titleAccent && <> <span className="mk-h1__grad">{titleAccent}</span></>}
            </h1>
            <p className="mk-lede">{lede}</p>
            {actions.length > 0 && (
              <div className="mk-actions">
                {actions.map((action) => <ActionLink key={action.href} {...action} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function ReferenceSection({ id, title, sub, tint, children }: {
  /** The page's own anchor — and therefore a row of the panel's index rail. */
  id?: string;
  title?: string;
  sub?: string;
  /** Alternate the band's ground so consecutive sections read as separate. */
  tint?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section {...(id ? { id } : {})} className={tint ? 'mk-band mk-band--tint' : 'mk-band'}>
      <div className="mk-in">
        {(title || sub) && (
          <div className="mk-center">
            {title && <h2>{title}</h2>}
            {sub && <p>{sub}</p>}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

/** The kit's card grid. `wide` is its 288px floor, for cards carrying prose. */
export function ReferenceGrid({ wide, children }: { wide?: boolean; children: React.ReactNode }) {
  return <div className={wide ? 'mk-grid mk-grid--wide' : 'mk-grid'}>{children}</div>;
}

/**
 * A titled run of cards inside a band — the shape `/integrations` categories
 * use. It takes an `id` for the same reason `ReferenceSection` does: when the
 * groups ARE the page's structure, they are what the panel's rail should list.
 */
export function ReferenceGroup({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <div {...(id ? { id } : {})} style={{ marginBottom: 'var(--space-6)', scrollMarginTop: 'var(--space-5)' }}>
      <h3 className="mk-card__title" style={{ marginBottom: 'var(--space-4)' }}>{title}</h3>
      {children}
    </div>
  );
}

/** A stable anchor id for a data-shaped section label. */
export function referenceAnchorId(label: string): string {
  return `ref-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

/**
 * A card. `href` makes it a link card; `mark` fills the kit's icon well, which
 * is where a step number goes too — a numbered "how it works" run and an icon
 * grid differ only in what sits in that well, so they are one component.
 */
export function ReferenceCard({ href, mark, title, badge, children }: {
  href?: string;
  mark?: React.ReactNode;
  title?: string;
  /** A short label to the right of the title (a control reference, a status). */
  badge?: string;
  children?: React.ReactNode;
}) {
  const body = (
    <>
      {(mark || badge) && (
        <div className="mk-card__top">
          {mark ? <span className="mk-card__icon">{mark}</span> : <span />}
          {badge && <span className="mk-badge">{badge}</span>}
        </div>
      )}
      {title && <h3 className="mk-card__title">{title}</h3>}
      {typeof children === 'string' ? <p className="mk-card__lede">{children}</p> : children}
    </>
  );
  return href
    ? <Link href={href} className="mk-card">{body}</Link>
    : <div className="mk-card">{body}</div>;
}

/**
 * The closing band. `--grad` is the kit's brand gradient — the second and last
 * place a page is allowed to use it, which is why the hero's accent and this
 * are the only two.
 */
export function ReferenceCta({ title, body, actions = [], children }: {
  title: string;
  body: string;
  actions?: ReferenceAction[];
  children?: React.ReactNode;
}) {
  return (
    <section className="mk-band mk-band--grad">
      <div className="mk-in">
        <h2>{title}</h2>
        <p>{body}</p>
        {children}
        {actions.length > 0 && (
          <div className="mk-actions">
            {actions.map((action) => <ActionLink key={action.href} {...action} />)}
          </div>
        )}
      </div>
    </section>
  );
}

export function ReferenceFaq({ items }: { items: Array<{ question: string; answer: string }> }) {
  return (
    <div className="mk-faq">
      {items.map((item) => (
        <details key={item.question} className="mk-q">
          <summary>
            {item.question}
            <svg className="mk-q__chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </summary>
          <p>{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
