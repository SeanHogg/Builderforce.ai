import type { SVGProps } from 'react';

/**
 * One restrained line-icon language for the application rail. Navigation used
 * to render platform-dependent emoji, which changed size, colour and baseline
 * between operating systems. These icons deliberately inherit the row colour.
 */
export function NavIcon({ name, ...props }: { name: string } & SVGProps<SVGSVGElement>) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  const paths: Record<string, React.ReactNode> = {
    dashboard: <><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9h13v-9M9.5 19v-5h5v5"/></>,
    seat: <><circle cx="12" cy="12" r="8.5"/><path d="m14.8 9.2-1.9 3.7-3.7 1.9 1.9-3.7 3.7-1.9Z"/></>,
    create: <><path d="M12 3 9.8 9.8 3 12l6.8 2.2L12 21l2.2-6.8L21 12l-6.8-2.2L12 3Z"/></>,
    challenges: <><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="m15.2 8.8 4-4M16.8 4.8h2.4v2.4"/></>,
    projects: <><rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M8 4v16M8 9h12M8 14h12"/></>,
    workforce: <><path d="M16 20v-1.8a3.7 3.7 0 0 0-3.7-3.7H7.7A3.7 3.7 0 0 0 4 18.2V20"/><circle cx="10" cy="8" r="3.2"/><path d="M16 5.2a3.2 3.2 0 0 1 0 6.2M20 20v-1.8a3.7 3.7 0 0 0-2.8-3.6"/></>,
    insights: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    growth: <><path d="M4 13.5v-3l14-5v13l-14-5Z"/><path d="M8 15v4h4v-2.5M18 10a3 3 0 0 1 0 4"/></>,
    quality: <><path d="M8 9h8M9 4l1.2 2M15 4l-1.2 2M6 13H3M21 13h-3M7 18l-2 2M17 18l2 2"/><rect x="6" y="6" width="12" height="13" rx="6"/><path d="M12 10v9"/></>,
    reliability: <><path d="M6 16.5h12l-1.6-2.1V10a4.4 4.4 0 0 0-8.8 0v4.4L6 16.5Z"/><path d="M10 19a2.2 2.2 0 0 0 4 0M12 3V1.8"/></>,
    knowledge: <><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v18H7.5A3.5 3.5 0 0 0 4 23V5.5ZM20 5.5A3.5 3.5 0 0 0 16.5 2H13v18h3.5A3.5 3.5 0 0 1 20 23V5.5Z"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    admin: <><path d="M12 3 4.5 6v5c0 4.7 3.2 8.2 7.5 10 4.3-1.8 7.5-5.3 7.5-10V6L12 3Z"/><path d="M9.5 12 11 13.5l3.5-3.5"/></>,
    sales: <><path d="M4 18 10 12l4 3 6-8"/><path d="M15 7h5v5"/></>,
    'sales-admin': <><path d="M4 18 10 12l4 3 6-8"/><path d="M15 7h5v5"/></>,
    'freelancer-dashboard': <><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9h13v-9M9.5 19v-5h5v5"/></>,
    'freelancer-profile': <><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></>,
    'freelancer-gigs': <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></>,
    'freelancer-workspace': <><path d="m14.5 6.5 3-3 3 3-3 3M13 8l-9.5 9.5V21H7l9.5-9.5"/></>,
    'freelancer-timecard': <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></>,
  };

  return <svg {...common} width="20" height="20" {...props}>{paths[name] ?? paths.create}</svg>;
}
