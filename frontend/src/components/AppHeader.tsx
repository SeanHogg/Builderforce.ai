'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ThemeToggleButton } from '@/app/ThemeProvider';

interface NavLink {
    label: string;
    href: string;
    variant?: 'default' | 'cta';
}

interface AppHeaderProps {
    /** Section label shown after the logo divider (e.g. "Workforce Registry") */
    section?: string;
    /** Right-side nav links */
    links?: NavLink[];
    /** Slot for right-side action elements (e.g. user email + button + sign-out) */
    actions?: React.ReactNode;
}

/**
 * AppHeader — shared sticky nav used by every authenticated and public page.
 * Uses CSS design-system variables so it adapts to light / dark theme.
 */
export default function AppHeader({ section, links, actions }: AppHeaderProps) {
    return (
        <header
            style={{
                position: 'sticky',
                top: 0,
                zIndex: 100,
                borderBottom: '1px solid var(--border-subtle)',
                background: 'color-mix(in srgb, var(--bg-surface) 90%, transparent)',
                backdropFilter: 'blur(18px)',
                WebkitBackdropFilter: 'blur(18px)',
                padding: '0 24px',
            }}
        >
            <div
                style={{
                    maxWidth: 1100,
                    margin: '0 auto',
                    height: 62,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                }}
            >
                {/* Left: logo + optional section label */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Link
                        href="/"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            textDecoration: 'none',
                            fontFamily: 'var(--font-display)',
                            fontWeight: 700,
                            fontSize: '1.05rem',
                            color: 'var(--text-primary)',
                        }}
                    >
                        <Image
                            src="/claw.png"
                            alt="Builderforce logo"
                            width={28}
                            height={28}
                            style={{ filter: 'drop-shadow(0 0 8px var(--logo-glow))', transition: 'filter 0.3s ease' }}
                        />
                        Builderforce.ai
                    </Link>

                    {section && (
                        <>
                            <span style={{ color: 'var(--border-subtle)', margin: '0 4px' }}>|</span>
                            <span
                                style={{
                                    color: 'var(--text-secondary)',
                                    fontWeight: 500,
                                    fontSize: '0.875rem',
                                    fontFamily: 'var(--font-display)',
                                }}
                            >
                                {section}
                            </span>
                        </>
                    )}
                </div>

                {/* Right: nav links + theme toggle + custom actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {links?.map(l =>
                        l.variant === 'cta' ? (
                            <Link
                                key={l.href}
                                href={l.href}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    padding: '7px 16px',
                                    borderRadius: 10,
                                    background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                                    color: '#fff',
                                    fontFamily: 'var(--font-display)',
                                    fontWeight: 600,
                                    fontSize: '0.875rem',
                                    textDecoration: 'none',
                                    boxShadow: '0 4px 14px var(--shadow-coral-mid)',
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                {l.label}
                            </Link>
                        ) : (
                            <Link
                                key={l.href}
                                href={l.href}
                                style={{
                                    fontSize: '0.875rem',
                                    color: 'var(--text-secondary)',
                                    textDecoration: 'none',
                                    padding: '6px 12px',
                                    borderRadius: 8,
                                    transition: 'color 0.2s, background 0.2s',
                                }}
                            >
                                {l.label}
                            </Link>
                        )
                    )}

                    <ThemeToggleButton />

                    {actions}
                </div>
            </div>
        </header>
    );
}
