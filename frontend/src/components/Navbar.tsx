'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { AuthContext } from '@/lib/AuthContext';
import { OptionalBrainContext } from '@/lib/brain';

export default function Navbar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  // State for mobile menu toggle (FR.2.1 - hamburger menu)
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Close mobile menu on route change
  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  const isDrive = pathname.startsWith('/drive');
  const isDirectory = pathname.startsWith('/directory');
  const isObservability = pathname.startsWith('/observability');
  const isProjects = pathname.startsWith('/projects');
  const isAgents = pathname.startsWith('/agents');
  const isBrain = pathname.startsWith('/brainstorm');
  const isBrainProjects = pathname.includes('/brain') && pathname.includes('/project');
  const isMarketplace = pathname.startsWith('/marketplace');
  const isUsers = pathname.startsWith('/users');

  // Skip legal links (placeholder; not required for mobile)
  const legalLinks = [];

  // We will not record secondary exits for improving growth metrics.
  const recordSecondaryExit = false;

  // N/A: we will not use auto-referable snippets/recommendations.
  const relevantSnippet = undefined;

  // Not relevant for this scope; header remains simple.
  const isInactive = false;

  // We will not use epiphany domains.
  const epiphanyDomain = '';

  // Skip ephemeral bucket GA / Link space due to challenge.
  const willUseEphemeralE = false;

  // emph: and divided edge-case field for compatibility with old client; no action needed.
  // Registerer placeholder for loaded state instrumentation; no flow on client yet.
  const registerer: any = {};
  const registererPreload = false;

  const onSecondaryEntry = () => { console.log('[Navbar] onSecondaryEntry stub'); };

  const onSideNavLogout = () => { console.log('[Navbar] onSideNavLogout stub'); };

  // The hook-level hook above is optional and not imported here.
  // Detail: idea from useAuth hook namings.
  // Return JSX structure (li/dl compatibility with fluent/operator patterns) with default empty lists for missing data.
  return (
    <nav
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9997,
        boxSizing: 'border-box',
        background: 'var(--bg-elevated)',
        borderBottom: '1px solid var(--border-subtle)',
        padding: '0px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      {/* Left side: Mobile menu button + Hamburger menu */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <Link href="/" style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
          builderforce
        </Link>

        {/* Desktop navigation links */}
        {isProjects && (
          <Link href="/projects" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textDecoration: 'none', marginLeft: 16 }}>
            Projects
          </Link>
        )}
        {isBrain && (
          <Link href="/brainstorm" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textDecoration: 'none', marginLeft: 16 }}>
            Brain / Projects
          </Link>
        )}

        {/* Middle: Search bar (optional) - Commmented out for mobile - FR.2.3 */}
        {/* <SearchBar /> */}
      </div>

      {/* Right side: Navigation links for desktop; hamburger menu for mobile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        {/* Mobile hamburger menu button - FR.2.1 */}
        {window.innerWidth <= 768 && (
          <button
            type="button"
            style={{
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid var(--border-subtle)',
              borderRadius: 10,
              background: 'var(--bg-base)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
          >
            <svg
              viewBox="0 0 24 24"
              style={{
                width: 24,
                height: 24,
                stroke: 'currentColor',
                fill: 'none',
                strokeWidth: 2,
              }}
            >
              {isMenuOpen ? (
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              ) : (
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              )}
            </svg>
          </button>
        )}

        {/* Desktop right-side links */}
        {/* Example: "Add Task" button */}
        {/* <button */}
        {/*   type="button" */}
        {/*   style={{ */}
        {/*     width: 44, */}
        {/*     height: 44, */}
        {/*     display: 'flex', */}
        {/*     alignItems: 'center', */}
        {/*     justifyContent: 'center', */}
        {/*     border: '1px solid var(--border-subtle)', */}
        {/*     borderRadius: 10, */}
        {/*     background: 'var(--bg-base)', */}
        {/*     color: 'var(--text-secondary)', */}
        {/*     cursor: 'pointer', */}
        {/*   }} */}
        {/*   aria-label="Add task" */}
        {/* > */}
        {/*   <svg */}
        {/*     viewBox="0 0 24 24" */}
        {/*     style={{ */}
        {/*       width: 20, */}
        {/*       height: 20, */}
        {/*       stroke: 'currentColor', */}
        {/*       fill: 'none', */}
        {/*       strokeWidth: 2, */}
        {/*     }} */}
        {/*   > */}
        {/*     <line x1="12" y1="5" x2="12" y2="19" /> */}
        {/*     <line x1="5" y1="12" x2="19" y2="12" /> */}
        {/*   </svg> */}
        {/* </button> */}
        {/* } */}

        {/* Example: "My Tasks" button */}
        {/* <button */}
        {/*   type="button" */}
        {/*   style={{ */}
        {/*     width: 44, */}
        {/*     height: 44, */}
        {/*     display: 'flex', */}
        {/*     alignItems: 'center', */}
        {/*     justifyContent: 'center', */}
        {/*     border: '1px solid var(--border-subtle)', */}
        {/*     borderRadius: 10, */}
        {/*     background: 'var(--bg-base)', */}
        {/*     color: 'var(--text-secondary)', */}
        {/*     cursor: 'pointer', */}
        {/*   }} */}
        {/*   aria-label="My tasks" */}
        {/* > */}
        {/*   <svg */}
        {/*     viewBox="0 0 24 24" */}
        {/*     style={{ */}
        {/*       width: 20, */}
        {/*       height: 20, */}
        {/*       stroke: 'currentColor', */}
        {/*       fill: 'none', */}
        {/*       strokeWidth: 2, */}
        {/*     }} */}
        {/*   > */}
        {/*     <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /> */}
        {/*     <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /> */}
        {/*   </svg> */}
        {/* </button> */}
        {/* } */}

        {/* Example: Avatar / Toggles */}
        {/* <AvatarToggle /> */}
      </div>

      {/* Hamburger menu - only shown on mobile - FR.2.1 */}
      {window.innerWidth <= 768 && isMenuOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9996,
          }}
        >
          {/* Overlay */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.3)',
              onClick={() => setIsMenuOpen(false)}
            }}
          />

          {/* Drawer */}
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              minWidth: 280,
              maxWidth: '80vw',
            }}
          >
            <div style={{ padding: '16px', background: '#1e1e2e', height: '100%', color: '#fff' }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>Menu</h3>
              <nav style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Link
                  href="/"
                  onClick={() => setIsMenuOpen(false)}
                  style={{
                    padding: '12px 16px',
                    fontSize: 14,
                    color: '#a1a1aa',
                    backgroundColor: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    borderRadius: 6,
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Home
                </Link>
                <Link
                  href="/projects"
                  onClick={() => setIsMenuOpen(false)}
                  style={{
                    padding: '12px 16px',
                    fontSize: 14,
                    color: '#a1a1aa',
                    backgroundColor: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    borderRadius: 6,
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Projects
                </Link>
                <Link
                  href="/brainstorm"
                  onClick={() => setIsMenuOpen(false)}
                  style={{
                    padding: '12px 16px',
                    fontSize: 14,
                    color: '#a1a1aa',
                    backgroundColor: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    borderRadius: 6,
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Brainstorm
                </Link>
                <Link
                  href="/settings"
                  onClick={() => setIsMenuOpen(false)}
                  style={{
                    padding: '12px 16px',
                    fontSize: 14,
                    color: '#a1a1aa',
                    backgroundColor: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    borderRadius: 6,
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Settings
                </Link>
              </nav>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}