import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Prometheus',
  description: 'Multi-Provider AI Chat & API Gateway',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        {children}
      </body>
    </html>
  );
}
