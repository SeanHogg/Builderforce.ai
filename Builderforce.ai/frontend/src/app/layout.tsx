import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Chat Titling',
  description: 'Chat management with automatic and manual title generation in Builderforce.ai',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {typeof document !== 'undefined' && (
          <>
            <style>{TAILWIND_STYLES}</style>
          </>
        )}
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  );
}

const TAILWIND_STYLES = `
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Global Variables for Chat Titles */
:root {
  --bg-surface: #ffffff;
  --bg-elevated: #f5f5f5;
  --bg-hover: #eeeeee;
  --border-subtle: #e0e0e0;
  --text-primary: #1a1a1a;
  --text-secondary: #666666;
  --text-muted: #999999;
  --coral-bright: #ff6b5e;
}

html.dark {
  --bg-surface: #1a1a1a;
  --bg-elevated: #2a2a2a;
  --bg-hover: #333333;
  --border-subtle: #404040;
  --text-primary: #ffffff;
  --text-secondary: #cccccc;
  --text-muted: #888888;
  --coral-bright: #ff6b5e;
}

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: var(--bg-surface);
}

::-webkit-scrollbar-thumb {
  background: var(--border-subtle);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}

/* Selection styling */
::selection {
  background: rgba(255, 107, 94, 0.3);
  color: inherit;
}

/* Focus ring for accessibility */
:focus-visible {
  outline: 2px solid var(--coral-bright);
  outline-offset: 2px;
}

/* Link styling */
a {
  color: var(--coral-bright);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}
`;