'use client';

/**
 * Global toast notifications powered by uiSlice.
 *
 * Mounted once at the root layout. Components dispatch `showToast({ type,
 * message })` and the toast appears here, auto-dismissing after the
 * configured duration.
 *
 * Positioning: bottom-right, stacked vertically, spring bounce-in from
 * the right with subtle overshoot for a satisfying "drop in" feel.
 */

import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import { dismissToast } from '@/lib/store/slices/uiSlice';

const TYPE_STYLES: Record<string, { wrap: string; accent: string; icon: string }> = {
  success: {
    wrap: 'bg-green-500/10 border-green-500/40 text-green-200',
    accent: 'bg-green-400',
    icon: 'M5 13l4 4L19 7',  // checkmark
  },
  error: {
    wrap: 'bg-red-500/10 border-red-500/40 text-red-200',
    accent: 'bg-red-400',
    icon: 'M6 18L18 6M6 6l12 12',  // X
  },
  info: {
    wrap: 'bg-blue-500/10 border-blue-500/40 text-blue-200',
    accent: 'bg-blue-400',
    icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',  // info
  },
  warning: {
    wrap: 'bg-amber-500/10 border-amber-500/40 text-amber-200',
    accent: 'bg-amber-400',
    icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',  // triangle
  },
};

export function ToastContainer() {
  const toasts = useAppSelector((s) => s.ui.toasts);
  const dispatch = useAppDispatch();

  // Auto-dismiss timer per toast. Using a single effect with [toasts] so
  // newly-added toasts get a timer immediately.
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts
      .filter((t) => t.duration > 0)
      .map((t) => {
        const remaining = t.duration - (Date.now() - t.createdAt);
        return setTimeout(() => dispatch(dismissToast(t.id)), Math.max(0, remaining));
      });
    return () => timers.forEach(clearTimeout);
  }, [toasts, dispatch]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map((toast) => {
        const styles = TYPE_STYLES[toast.type] ?? TYPE_STYLES.info;
        return (
          <div
            key={toast.id}
            role="alert"
            className={`pointer-events-auto pl-3 pr-3 py-2.5 rounded-xl border backdrop-blur-md shadow-2xl text-sm font-medium animate-toast-bounce flex items-start gap-3 relative overflow-hidden ${styles.wrap}`}
          >
            {/* Left accent stripe */}
            <span className={`absolute left-0 top-0 bottom-0 w-1 ${styles.accent}`} />
            <svg
              className="w-4 h-4 mt-0.5 shrink-0 opacity-80"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={styles.icon} />
            </svg>
            <span className="flex-1 break-words leading-relaxed">{toast.message}</span>
            <button
              type="button"
              onClick={() => dispatch(dismissToast(toast.id))}
              className="text-current/60 hover:text-current text-lg leading-none -mt-0.5 transition-colors"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
