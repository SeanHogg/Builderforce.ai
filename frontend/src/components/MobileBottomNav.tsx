'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams, useRouter as useNavRouter } from 'next/navigation';

const TABS: { id: string; label: string; href: string }[] = [
  { id: 'home', label: 'Home', href: '/' },
  { id: 'projects', label: 'Projects', href: '/projects' },
  { id: 'brainstorm', label: 'Brainstorm', href: '/brainstorm' },
  { id: 'settings', label: 'Settings', href: '/settings' },
];

const ICONS: Record<string, React.ReactNode> = {
  home: (
    <svg viewBox="0 0 24 24" width={24} height={24} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
      <polyline points="9 22 9 12 15 12 15 22"></polyline>
    </svg>
  ),
  projects: (
    <svg viewBox="0 0 24 24" width={24} height={24} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 7h20"></path>
      <path d="M17 17H2v-7h15"></path>
      <path d="M22 7v8"></path>
      <path d="M22 10h-1"></path>
    </svg>
  ),
  brainstorm: (
    <svg viewBox="0 0 24 24" width={24} height={24} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path>
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" width={24} height={24} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"></circle>
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
    </svg>
  ),
};

const TAB_LABELS: Record<string, string> = {
  home: 'Home',
  projects: 'Projects',
  brainstorm: 'Brainstorm',
  settings: 'Settings',
};

export default function MobileBottomNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useNavRouter();
  const [activeTab, setActiveTab] = useState('');

  useEffect(() => {
    const initialTab = TABS.find((t) => pathname.startsWith(t.href))?.id || 'home' || TABS[0].id;
    setActiveTab(initialTab);
  }, [pathname]);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    const tab = TABS.find((t) => t.id === tabId);
    if (!tab) return;

    // Check if we need to preserve query params
    if (tab.href === pathname && pathname !== '/') {
      router.push(tab.href);
    } else {
      // For routes that support ?tab=tasks (e.g., /projects), always go to the tab
      router.push(tab.href);
    }
  };

  if (!pathname) return null;

  const currentTab = TABS.find((t) => pathname.startsWith(t.href))?.id || TABS[0].id;
  const isActive = (tabId: string) => tabId === currentTab;

  return (
    <div
      className="mobile-bottom-nav"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        display: 'flex',
        gap: 4,
        justifyContent: 'space-around',
        overflowY: 'auto',
        backgroundColor: 'var(--bg-base, #1e1e2e)', // Use consistent dark background
        boxShadow: '0 -2px 8px rgba(0,0,0,0.15)',
        zIndex: 1000,
        borderTop: '1px solid var(--border-subtle, #333)',
        maxHeight: '60px', // Keep the nav bar compact
        padding: '6px 0', // Ensure padding for touch targets
      }}
    >
      {TABS.map(({ id, label, href }) => {
        const active = isActive(id);
        const icon = ICONS[id];

        return (
          <button
            key={id}
            type="button"
            onClick={() => handleTabChange(id)}
            aria-label={TABS.find((t) => t.id === id)?.label}
            aria-current={active ? 'page' : undefined}
            style={{
              display: 'inline-flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%', // Use full width of the container
              height: '100%', // Ensure vertical alignment
              gap: 4,
              color: active ? '#f4726e' : '#a1a1aa',
              padding: '6px 16px', // Slight padding for better touch placement
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              cursor: 'pointer', // Explicitly set cursor type
              borderRadius: '0', // Remove border radius for consistent look
              minWidth: '44px', // Minimum touch target size
              minHeight: '44px', // Minimum touch target size
              transition: 'color 0.2s ease',
              textAlign: 'center',
            }}
          >
            <div style={{ position: 'relative' }}>
              {icon}
            </div>
            <span
              style={{
                fontSize: '11px',
                lineHeight: 1,
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '60px', // Prevent text from wrapping to two lines
                whiteSpace: 'nowrap',
                fontFamily:
                  'var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif)',
              }}
            >
              {TABS.find((t) => t.id === id)?.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}