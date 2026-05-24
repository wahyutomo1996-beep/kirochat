/**
 * Typed hooks. Use these instead of plain `useDispatch` / `useSelector` so
 * you get autocomplete on actions and full type safety on selectors.
 *
 * Usage:
 *   const dispatch = useAppDispatch();
 *   const toasts = useAppSelector((s) => s.ui.toasts);
 */

import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';
import type { AppDispatch, RootState } from './index';

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
