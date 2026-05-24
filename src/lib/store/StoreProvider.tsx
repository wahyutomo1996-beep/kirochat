'use client';

/**
 * Client-side Redux Provider.
 *
 * Stores are created per-request in Next.js App Router (one per browser
 * session, persisted via React refs). This pattern is recommended by Redux
 * Toolkit for Next.js 13+ to avoid sharing state across requests during SSR.
 *
 * Wrapping in a 'use client' boundary so the rest of the app tree can mix
 * server and client components freely above this provider.
 */

import { useRef, type ReactNode } from 'react';
import { Provider } from 'react-redux';
import { makeStore, type AppStore } from './index';

export function StoreProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<AppStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = makeStore();
  }

  return <Provider store={storeRef.current}>{children}</Provider>;
}
