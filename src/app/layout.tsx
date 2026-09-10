import type { Metadata } from 'next';
import './globals.css';

const COMPANY = process.env.NEXT_PUBLIC_APP_NAME ?? 'Artfresh';

export const metadata: Metadata = {
  title: {
    default: `${COMPANY} Customer Portal`,
    template: `%s · ${COMPANY}`,
  },
  description: `Apply for a trade account with ${COMPANY}, place orders, and track deliveries.`,
  // Falls back to Next's default when no icon file is present, rather than
  // rendering a broken one.
  icons: process.env.NEXT_PUBLIC_HAS_LOGO === 'true'
    ? { icon: '/favicon.png', apple: '/favicon.png' }
    : undefined,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
