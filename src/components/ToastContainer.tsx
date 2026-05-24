'use client';

/**
 * Global toast notifications powered by uiSlice.
 *
 * Mounted once at the root layout. Components dispatch `showToast({ type,
 * message })` and the toast appears here, auto-dismissing after the
 * configured duration.
 *
 * Positioning: bottom-right, stacked vertically, slide-in from right.
 */

import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import { dismissToast } from '@/lib/store/slices/uiSlice';

const TYPE_STYLES: Record<string, string> = {
  success: 'bg-green-500/15 border-green-500/40 text-green-200',
  error: 'bg-red-500/15 border-red-500/40 text-red-200',
  info: 'bg-blue-500/15 border-blue-500/40 text-blue-200',
  warning: 'bg-amber-500/15 border-amber-500/40 text-amber-200',
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
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          className={`px-4 py-3 rounded-lg border backdrop-blur-md shadow-lg text-sm font-medium animate-slide-up flex items-start gap-3 ${
            TYPE_STYLES[toast.type] ?? TYPE_STYLES.info
          }`}
        >
          <span className="flex-1 break-words">{toast.message}</span>
          <button
            type="button"
            onClick={() => dispatch(dismissToast(toast.id))}
            className="text-current/70 hover:text-current text-lg leading-none -mt-0.5"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
