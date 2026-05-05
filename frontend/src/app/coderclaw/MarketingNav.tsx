'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ThemeToggleButton } from '@/app/ThemeProvider';

/**
 * Single nav for /coderclaw/* pages. Decides its own active-link state from
 * `usePathname()`, so consumers (the layout) just drop it in — no props.
 *
 * The Docs link is rendered as a plain <a> because /docs/* is served by a
 * separate Cloudflare Pages deployment (Astro Starlight) that Next.js cannot
 * client-route into.
 */
const NEXT_LINKS = [
  { label: 'Showcase', href: '/coderclaw/showcase' },
  { label: 'Integrations', href: '/coderclaw/integrations' },
  { label: 'Skills', href: '/coderclaw/skills' },
  { label: 'Shoutouts', href: '/coderclaw/shoutouts' },
] as const;

export default function MarketingNav() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href;

  return (
    <header className="cc-nav">
      <div className="cc-nav-inner">
        <Link href="/coderclaw" className="cc-nav-logo">
          <Image
            src="/coderclaw.png"
            alt="CoderClaw"
            width={32}
            height={32}
            style={{ filter: 'drop-shadow(0 0 10px var(--logo-glow))' }}
          />
          <span>CoderClaw</span>
          <span className="cc-nav-subtle">by Builderforce.ai</span>
        </Link>
        <nav className="cc-nav-right">
          {NEXT_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`cc-nav-link${isActive(l.href) ? ' active' : ''}`}
            >
              {l.label}
            </Link>
          ))}
          <a href="/docs" className="cc-nav-link">Docs</a>
          <Link href="/" className="cc-nav-link">Builderforce.ai</Link>
          <a
            href="https://github.com/seanhogg/coderclaw"
            target="_blank"
            rel="noopener"
            className="cc-nav-link"
          >
            GitHub
          </a>
          <ThemeToggleButton />
        </nav>
      </div>
      <style>{`
        .cc-nav {
          position: sticky;
          top: 0;
          z-index: 100;
          border-bottom: 1px solid var(--border-subtle);
          background: color-mix(in srgb, var(--bg-surface) 88%, transparent);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }
        .cc-nav-inner {
          max-width: 1100px;
          margin: 0 auto;
          padding: 0 24px;
          height: 62px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }
        .cc-nav-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          text-decoration: none;
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 1.1rem;
          color: var(--text-primary);
        }
        .cc-nav-subtle {
          font-weight: 400;
          font-size: 0.78rem;
          color: var(--text-muted);
          margin-left: 4px;
        }
        .cc-nav-right {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-wrap: wrap;
        }
        .cc-nav-link {
          font-size: 0.875rem;
          color: var(--text-secondary);
          text-decoration: none;
          padding: 6px 10px;
          border-radius: 8px;
          transition: color 0.2s ease, background 0.2s ease;
        }
        .cc-nav-link:hover {
          color: var(--text-primary);
          background: var(--surface-interactive, rgba(136,146,176,0.08));
        }
        .cc-nav-link.active {
          color: var(--coral-bright);
        }
        @media (max-width: 720px) {
          .cc-nav-subtle { display: none; }
          .cc-nav-inner { padding: 0 12px; }
        }
      `}</style>
    </header>
  );
}
