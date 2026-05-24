/**
 * UI slice — toast notifications, modal state, theme preferences.
 *
 * Lives outside RTK Query because this is pure client state, not server-cached
 * data. Used for ephemeral UX feedback (success messages after mutations,
 * confirmation modals, etc).
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  /** Auto-dismiss after this many ms. 0 = sticky. */
  duration: number;
  createdAt: number;
}

export interface UiState {
  toasts: Toast[];
  /** Currently open modal id (null = none) */
  activeModal: string | null;
  modalPayload: unknown;
  /** Whether the mobile sidebar is open */
  sidebarOpen: boolean;
}

const initialState: UiState = {
  toasts: [],
  activeModal: null,
  modalPayload: null,
  sidebarOpen: false,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    showToast: {
      reducer(state, action: PayloadAction<Toast>) {
        state.toasts.push(action.payload);
        // Cap toast queue to prevent runaway accumulation
        if (state.toasts.length > 5) {
          state.toasts.shift();
        }
      },
      prepare(payload: { type: ToastType; message: string; duration?: number }) {
        return {
          payload: {
            id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: payload.type,
            message: payload.message,
            duration: payload.duration ?? 4000,
            createdAt: Date.now(),
          },
        };
      },
    },
    dismissToast(state, action: PayloadAction<string>) {
      state.toasts = state.toasts.filter((t) => t.id !== action.payload);
    },
    clearToasts(state) {
      state.toasts = [];
    },
    openModal(state, action: PayloadAction<{ id: string; payload?: unknown }>) {
      state.activeModal = action.payload.id;
      state.modalPayload = action.payload.payload ?? null;
    },
    closeModal(state) {
      state.activeModal = null;
      state.modalPayload = null;
    },
    setSidebarOpen(state, action: PayloadAction<boolean>) {
      state.sidebarOpen = action.payload;
    },
  },
});

export const {
  showToast,
  dismissToast,
  clearToasts,
  openModal,
  closeModal,
  setSidebarOpen,
} = uiSlice.actions;

export default uiSlice.reducer;
