'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import { useRouter, usePathname } from 'next/navigation';
import { taskTemplates } from '@/lib/builderforceApi';
import { useOptionalBrainContext } from '@/lib/brain';
import { useOptionalTenant } from '@/lib/tenant';

// Example imports/components for branding/layout:
// import { MarketplaceCrumb } from '@/components/MarketplaceCrumb';
// import { PageNav } from '@/components/PageNav';

export function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const { isAuthenticated, currentTenant } = useAuth();
  const brain = useOptionalBrainContext();
  const tenant = useOptionalTenant();

  // Peanut detection without inline styles; utility will provide class names.
  // Use touch-friendly selectors (aria buttons).
  // Above (and below) ensure min 44x44 touch targets.
  // On mobile, featuring a hamburger menu for main nav.

  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const pathName = usePathname();
  const subdomain = hostname.split('.')[0]; // f.ex. 'stage'
  const isDrive = subdomain === 'drive' && pathName.startsWith('/drive');
  const isDirectory = subdomain === 'directory' && pathName.startsWith('/directory');
  const isObservability = pathName.startsWith('/observability');
  const isProjects = pathName.startsWith('/projects');
  const isAgents = pathName.startsWith('/agents');
  const isBrain = pathName.startsWith('/brainstorm') || pathName.startsWith('/brain');
  const isBrainProjects = pathName.startsWith('/brain') && pathName.includes('/project');
  const isMarketplace = pathName.startsWith('/marketplace');
  const isUsers = pathName.startsWith('/users');
  // Special case: /projects/tasks redirects to /projects?tab=tasks
  const isProjectsTasks = pathName === '/projects';

  const isLoggingIn = pathName.startsWith('/login');
  const isRegistering = pathName.startsWith('/register');
  const isTenantSetup = pathName.startsWith('/setup') && pathName.length > 7;
  const isTenantLanding = pathName === '/tenants';
  const isTenantDetail = isTenantSetup;

  // Sidebar

  // Example route logic:
  // const getBasePath = () => {
  //   if (isDrive) return '/drive';
  //   if (isDirectory) return '/directory';
  //   if (isObservability) return '/observability';
  //   if (isProjects) return '/projects';
  //   if (isAgents) return '/agents';
  //   if (isBrain) return '/brainstorm';
  //   if (isMarketplace) return '/marketplace';
  //   if (isUsers) return '/users';
  //   // Special handling for /projects/tasks to avoid duplicate /projects paths:
  //   if (isProjectsTasks) return '/projects';
  //   return '/';
  // };

  // Example legal links:
  // const legalLinks = [{ href: '/privacy', label: 'Privacy' }, { href: '/terms', label: 'Terms' }, { href: '/accessibility', label: 'Accessibility' }];

  // The hook-level hook above is optional and not imported here.

  if (isLoggingIn || isRegistering) return null;
  if (!isAuthenticated) return null;
  if (isTenantLanding || (isTenantDetail && subdomain !== 'directory')) return null;

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
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      {/* Left side: Mobile menu button + Hamburger menu */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        {/* Check if current tenant is default for the organization; update link title accordingly */}
        const isTenantDefault = tenant?.isDefault ?? false;
        const defaultTenantHref = isTenantDefault ? '/' : `/tenants/${String(tenant?.id)}`;

        <button
          type="button"
          aria-expand={isMenuOpen ? 'true' : 'false'}
          aria-controls='mobile-menu'
          aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          style={{
            width: 44,
            height: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid var(--border-subtle)',
            borderRadius: 10, // Larger border radius
            background: 'var(--bg-base)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: 0, // Explicit padding removal
          }}
        >
          <svg
            viewBox="0 0 24 24"
            style={{
              width: 24,
              height: 24,
              display: isMenuOpen ? 'none' : 'block',
              stroke: 'currentColor',
              fill: 'none',
              strokeWidth: 2,
            }}
          >
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
          <svg
            viewBox="0 0 24 24"
            style={{
              width: 24,
              height: 24,
              display: isMenuOpen ? 'block' : 'none',
              stroke: 'currentColor',
              fill: 'none',
              strokeWidth: 2,
            }}
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Logo and logo link are omitted for brevity */
        // <Logo /> and <Link href={homePath} style={{ display: 'flex', alignItems: 'center', gap: 8 }} />
        // }
        {/* Middle: Search bar (optional) */}
        {/* <SearchBar /> */}
      </div>

      {/* Right side: Navigation links for desktop; hamburger menu for mobile */}
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
        //     borderRadius: 10, // Larger border radius
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
        //     borderRadius: 10, // Larger border radius
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
          role="presentation"
          onClick={e => { e.stopPropagation(); }}
        >
          {/* Overlay */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.3)',
              transition: 'opacity 0.15s ease-out',
            }}
            onClick={e => { e.stopPropagation(); setIsMenuOpen(false); }}
            aria-hidden
          />

          {/* Drawer */}
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: '300px', // Example: 80vw/min(32rem)
              maxWidth: '85vw',
              overflowY: 'auto',
              boxShadow: '-4px 0 16px rgba(0,0,0,0.14)',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Example: Close button */}
            {/* <button
              type="button"
              onClick={() => setIsMenuOpen(false)}
              aria-label="Close menu"
              style={{
                width: 44,
                height: 44,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                background: 'var(--bg-base)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button> */}

            {/* Example: Links */}
            {/* <nav style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: 0 }}>
              {legalLinks.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  prefetch={false}
                  style={{
                    padding: '12px 16px',
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                    textDecoration: 'none',
                    display: 'block',
                  }}
                >
                  {label}
                </Link>
              ))}
            </nav> */}
          </div>
        </div>
      )}
    </nav>
  );
}