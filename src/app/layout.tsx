import type { Metadata, Viewport } from 'next';
import { StoreProvider } from '@/lib/store/StoreProvider';
import { ToastContainer } from '@/components/ToastContainer';
import { ServiceWorkerRegistrar } from '@/components/ServiceWorkerRegistrar';
import './globals.css';

export const metadata: Metadata = {
  title: 'Prometheus',
  description: 'Multi-Provider AI Chat & API Gateway',
  // PWA / Apple Web App metadata. Tells iOS Safari + browsers this
  // can be added to the home screen and how it should look there.
  manifest: '/manifest.webmanifest',
  applicationName: 'Prometheus',
  appleWebApp: {
    capable: true,
    title: 'Prometheus',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-icon.png',
  },
};

/**
 * Viewport config — separate from metadata since Next.js 14 split
 * these. theme-color tints the Android Chrome address bar + the
 * splash screen status bar in PWA standalone mode.
 */
export const viewport: Viewport = {
  themeColor: '#5e6ad2',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  // Allow the standalone PWA to use the full safe-area inset on
  // notched devices (iPhone X+, modern Android with display cutout).
  viewportFit: 'cover',
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
        {/*
          Service worker registration — production only. Provides PWA
          offline shell + makes the app installable via Chrome's install
          prompt. See public/sw.js for caching strategy.
        */}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
