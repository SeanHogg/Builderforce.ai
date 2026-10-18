import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { BrandLockup } from '@/components/BrandLockup';
import { ThemeToggleButton } from '@/components/ThemeToggleButton';
import { Icon } from '@/components/ui/Icon';
import MarketingFaq from '@/components/marketing/MarketingFaq';
import MarketingVisual from '@/components/account/MarketingVisual';
import { resolveAuthPanel, type AuthPanelId } from '@/lib/content/auth';

/**
 * The frame of the sign-in and sign-up screens: sticky brand nav, a centred form
 * column (heading, feature pills, then whatever the screen puts in it), and — from
 * 900px up — the marketing panel beside it. Below that the panel is hidden, so at
 * 360px the form is the whole screen. Colour comes from theme tokens only.
 */
export interface AuthShellProps {
  /** The nav's right-hand action (Sign up / Sign in). */
  navAction: ReactNode;
  heading: string;
  subtitle: string;
  pills: string[];
  /** Which marketing copy the right-hand panel shows. */
  panel: AuthPanelId;
  visual: 'standard' | 'freelancer' | 'sales';
  /** Heading above the panel's FAQ. */
  faqHeading: string;
  /** Re-mounts (and fades in) the panel when it changes — register's Build/Hired chooser. */
  panelKey?: string;
  /** The form area. */
  children: ReactNode;
  /** The line under the form linking to the other screen. */
  footer: ReactNode;
  /** Overlays that belong to the screen (a legal-document modal). */
  overlay?: ReactNode;
}

export function AuthShell({
  navAction, heading, subtitle, pills, panel, visual, faqHeading, panelKey, children, footer, overlay,
}: AuthShellProps) {
  const tRoot = useTranslations();
  const marketing = resolveAuthPanel(tRoot, panel);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-deep)', color: 'var(--text-primary)', position: 'relative', zIndex: 1 }}>
      <nav style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        borderBottom: '1px solid var(--border-subtle)',
        background: 'color-mix(in srgb, var(--bg-surface) 90%, transparent)',
        backdropFilter: 'blur(16px)',
        padding: '0 24px',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <BrandLockup href="/" label="Builderforce.ai" size={28}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
              Builderforce.ai
            </span>
          </BrandLockup>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ThemeToggleButton />
            {navAction}
          </div>
        </div>
      </nav>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', minHeight: 'calc(100vh - 60px)', alignItems: 'start' }} className="auth-split-grid">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 20px', minHeight: 'calc(100vh - 60px)' }}>
            <div style={{ width: '100%', maxWidth: 420 }}>
              <div style={{ textAlign: 'center', marginBottom: 28 }}>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 700, marginBottom: 6, color: 'var(--text-primary)' }}>
                  {heading}
                </h1>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{subtitle}</p>
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 28 }}>
                {pills.map(f => (
                  <span key={f} style={{
                    fontSize: '0.75rem', fontWeight: 600,
                    background: 'var(--surface-coral-soft)',
                    color: 'var(--coral-bright)',
                    border: '1px solid var(--border-accent)',
                    borderRadius: 'var(--radius-full)', padding: '4px 12px',
                    fontFamily: 'var(--font-display)',
                  }}>{f}</span>
                ))}
              </div>

              {children}

              <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: 20 }}>{footer}</p>
            </div>
          </div>

          {overlay}

          <aside className="auth-marketing-panel" style={{
            display: 'none', /* overridden by media query */
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '48px 40px',
            background: 'var(--surface-card)',
            borderLeft: '1px solid var(--border-subtle)',
          }}>
            <div key={panelKey} className="auth-marketing-content">
              <span style={{
                display: 'inline-block', marginBottom: 12,
                fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                color: 'var(--coral-bright)', background: 'var(--surface-coral-soft)',
                border: '1px solid var(--border-accent)', borderRadius: 'var(--radius-full)', padding: '4px 12px',
                fontFamily: 'var(--font-display)',
              }}>{marketing.eyebrow}</span>

              <MarketingVisual variant={visual} />

              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
                {marketing.heading}
              </h2>
              <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 24 }}>
                {marketing.intro}
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
                {marketing.stats.map(s => (
                  <div key={s.id} style={{ padding: '14px 12px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', textAlign: 'center', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700, color: 'var(--coral-bright)' }}>{s.value}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {marketing.bullets.map(b => (
                  <li key={b.id} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ flexShrink: 0 }} aria-hidden><Icon source={b.icon} size={18} /></span>
                    <span><strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{b.title}</strong> — {b.desc}</span>
                  </li>
                ))}
              </ul>

              <blockquote style={{ margin: '0 0 24px', padding: '14px 18px', borderLeft: '3px solid var(--coral-bright)', background: 'var(--bg-elevated)', borderRadius: '0 var(--radius-lg) var(--radius-lg) 0', fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                &ldquo;{marketing.quote}&rdquo;
              </blockquote>

              {/* FAQ section for GEO citability */}
              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 20 }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {faqHeading}
                </h3>
                <MarketingFaq items={marketing.faq} />
              </div>
            </div>
          </aside>
        </div>
      </div>

      <style>{`
        @media (min-width: 900px) {
          .auth-split-grid { grid-template-columns: 1fr 1fr !important; }
          .auth-marketing-panel { display: flex !important; }
        }
        .auth-marketing-content { animation: authMarketingFade 0.35s ease; }
        @keyframes authMarketingFade {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .auth-marketing-content { animation: none; }
        }
      `}</style>
    </div>
  );
}
