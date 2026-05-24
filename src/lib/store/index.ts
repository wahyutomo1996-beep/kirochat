/**
 * Redux store configuration.
 *
 * Composes:
 *   - baseApi (RTK Query) - all server data lives here, cached & deduped
 *   - uiSlice              - ephemeral UI state (toasts, modals, sidebar)
 *
 * Each feature API slice (kiroAccountsApi, providersApi, etc) is injected
 * into baseApi via `injectEndpoints`, so we don't need to register them
 * individually in `reducer`. Just import them once anywhere in the app to
 * register their endpoints.
 *
 * Middleware: RTK Query's middleware is required for caching, polling, and
 * automatic invalidation to work. `setupListeners` enables refetchOnFocus
 * and refetchOnReconnect.
 */

import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { baseApi } from './api/baseApi';
import uiReducer from './slices/uiSlice';

// Force-import all endpoint slices so their endpoints are registered with
// baseApi. Without these imports the hooks would exist but the endpoints
// wouldn't be wired into the store. (Tree-shaking won't drop these because
// they have side effects on baseApi.)
import './api/authApi';
import './api/kiroAccountsApi';
import './api/providersApi';
import './api/conversationsApi';
import './api/dashboardApi';
import './api/apiKeyApi';
import './api/healthApi';
import './api/adminUsersApi';
import './api/combosApi';

export const makeStore = () => {
  const store = configureStore({
    reducer: {
      [baseApi.reducerPath]: baseApi.reducer,
      ui: uiReducer,
    },
    middleware: (getDefault) =>
      getDefault({
        // RTK Query handles its own internal serialization; the default
        // serializableCheck warns about Dates in our payloads otherwise.
        serializableCheck: {
          ignoredActions: ['ui/showToast'],
          ignoredPaths: ['ui.modalPayload'],
        },
      }).concat(baseApi.middleware),
    devTools: process.env.NODE_ENV !== 'production',
  });

  // Wire refetchOnFocus / refetchOnReconnect.
  setupListeners(store.dispatch);

  return store;
};

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
