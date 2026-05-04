'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_GROUPS = [
  {
    title: 'Getting Started',
    links: [
      { label: 'Quick Start', href: '/coderclaw/docs/getting-started' },
      { label: 'Installation', href: '/coderclaw/docs/getting-started#installation' },
      { label: 'Your First Agent', href: '/coderclaw/docs/getting-started#first-agent' },
    ],
  },
  {
    title: 'Guides',
    links: [
      { label: 'All Guides', href: '/coderclaw/docs/guides' },
      { label: 'Creating Agents', href: '/coderclaw/docs/guides#agents' },
      { label: 'Sub-Agents', href: '/coderclaw/docs/guides#subagents' },
      { label: 'Mesh Orchestration', href: '/coderclaw/docs/guides#orchestration' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'API Reference', href: '/coderclaw/docs/api-reference' },
      { label: 'Examples', href: '/coderclaw/docs/examples' },
      { label: 'vs. Alternatives', href: '/coderclaw/docs/coderclaw-vs-alternatives' },
    ],
  },
];

export default function DocsSidebar() {
  const pathname = usePathname();
  return (
    <aside className="cc-docs-sidebar">
      {NAV_GROUPS.map((g) => (
        <div key={g.title} className="cc-docs-group">
          <h3 className="cc-docs-group-title">{g.title}</h3>
          <nav>
            {g.links.map((l) => {
              const linkPath = l.href.split('#')[0];
              const isActive = pathname === linkPath;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`cc-docs-link${isActive ? ' active' : ''}`}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
        </div>
      ))}
      <style>{`
        .cc-docs-sidebar {
          display: flex;
          flex-direction: column;
          gap: 24px;
          position: sticky;
          top: 80px;
          height: fit-content;
        }
        .cc-docs-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .cc-docs-group-title {
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          margin: 0;
        }
        .cc-docs-link {
          display: block;
          padding: 6px 10px;
          color: var(--text-secondary);
          text-decoration: none;
          font-size: 0.875rem;
          border-radius: 6px;
          border-left: 2px solid transparent;
          transition: background 0.15s, color 0.15s;
        }
        .cc-docs-link:hover {
          background: var(--surface-interactive, rgba(136,146,176,0.08));
          color: var(--text-primary);
        }
        .cc-docs-link.active {
          color: var(--text-primary);
          border-left-color: var(--coral-bright);
          background: var(--surface-interactive, rgba(136,146,176,0.08));
          font-weight: 500;
        }
        @media (max-width: 900px) {
          .cc-docs-sidebar {
            position: static;
            flex-direction: row;
            flex-wrap: wrap;
            gap: 12px 24px;
            border-bottom: 1px solid var(--border-subtle);
            padding-bottom: 16px;
          }
        }
      `}</style>
    </aside>
  );
}
