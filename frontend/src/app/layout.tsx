import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Builderforce.ai',
  description: 'AI-powered coding platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-white min-h-screen">
        {children}
      </body>
    </html>
  );
}
