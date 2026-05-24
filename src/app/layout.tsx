import type { Metadata } from 'next';
import { StoreProvider } from '@/lib/store/StoreProvider';
import { ToastContainer } from '@/components/ToastContainer';
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
        {/*
          StoreProvider wraps the entire app so any client component can
          dispatch / select. RTK Query endpoints are auto-registered via the
          imports in src/lib/store/index.ts.
        */}
        <StoreProvider>
          {children}
          <ToastContainer />
        </StoreProvider>
      </body>
    </html>
  );
}
