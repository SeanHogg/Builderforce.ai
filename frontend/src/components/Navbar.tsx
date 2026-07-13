'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { AuthContext } from '@/lib/AuthContext';
import { OptionalBrainContext } from '@/lib/brain';

export default function Navbar() {
  // Scoped to tenants (drive/directory/observability) via path but not yet incoming retrieval.
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
        {/* Example: default tenant link */}
        {/* <Link href={defaultTenantHref} style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textDecoration: 'none' }}>
          {tenant?.name || 'Home'}
          {logo}
        </Link> */}

        {/* Links are omitted for brevity */
        // <Link href='/projects' style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textDecoration: 'none' }}>
        //   Projects
        // </Link>
        // <Link href='/brainstorm' style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textDecoration: 'none' }}>
        //   Brain / Project
        // </Link>
        // }
        {/* Middle: Search bar (optional) */}
        {/* <SearchBar /> */}
      </div>

      {/* Right side: Navigation links for desktop; hamburger menu for mobile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        {/* Example: "Add Task" button */
        // <button
        //   type="button"
        //   style={{
        //     width: 44,
        //     height: 44,
        //     display: 'flex',
        //     alignItems: 'center',
        //     justifyContent: 'center',
        //     border: '1px solid var(--border-subtle)',
        //     borderRadius: 10,
        //     background: 'var(--bg-base)',
        //     color: 'var(--text-secondary)',
        //     cursor: 'pointer',
        //   }}
        //   aria-label="Add task"
        // >
        //   <svg
        //     viewBox="0 0 24 24"
        //     style={{
        //       width: 20,
        //       height: 20,
        //       stroke: 'currentColor',
        //       fill: 'none',
        //       strokeWidth: 2,
        //     }}
        //   >
        //     <line x1="12" y1="5" x2="12" y2="19" />
        //     <line x1="5" y1="12" x2="19" y2="12" />
        //   </svg>
        // </button>
        // }

        {/* Example: "My Tasks" button */
        // <button
        //   type="button"
        //   style={{
        //     width: 44,
        //     height: 44,
        //     display: 'flex',
        //     alignItems: 'center',
        //     justifyContent: 'center',
        //     border: '1px solid var(--border-subtle)',
        //     borderRadius: 10,
        //     background: 'var(--bg-base)',
        //     color: 'var(--text-secondary)',
        //     cursor: 'pointer',
        //   }}
        //   aria-label="My tasks"
        // >
        //   <svg
        //     viewBox="0 0 24 24"
        //     style={{
        //       width: 20,
        //       height: 20,
        //       stroke: 'currentColor',
        //       fill: 'none',
        //       strokeWidth: 2,
        //     }}
        //   >
        //     <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        //     <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        //   </svg>
        // </button>
        // }

        {/* Example: Avatar / Toggles */
        // <AvatarToggle />
      </div>

      {/* Hamburger menu */}
      {isMenuOpen && (
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
            }}
            onClick={() => setIsMenuOpen(false)}
          />

          {/* Drawer */}
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
            }}
            onClick={e => e.stopPropagation()}
          >
            {legalLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                prefetch={false}
                style={{ padding: '12px 16px' }}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}