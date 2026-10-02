/**
 * The safe-area insets as padding, for screens drawn outside the app shell
 * (the website, /login, /in, /account). The app shell takes them in `Edges`
 * (App.tsx); these screens render before it, so on an iPhone opened from the
 * home screen — which draws under the status bar (index.html, black-translucent)
 * — their header sat under the clock (owner, 2 Oct 2026).
 *
 * The values are the CSS variables index.html sets from `env(safe-area-inset-*)`,
 * never `env()` itself (that is read in one place). In a browser tab they are 0.
 */
import { Platform } from 'react-native';

const web = Platform.OS === 'web';
const plus = (side: 'sat' | 'sab' | 'sal' | 'sar', px: number) => (web ? (`calc(var(--epic-${side}) + ${px}px)` as unknown as number) : px);

/** `px` of padding plus the status bar's height. */
export const insetTop = (px: number) => plus('sat', px);
/** `px` of padding plus the home indicator's height. */
export const insetBottom = (px: number) => plus('sab', px);
/** `px` of padding plus the left inset (a phone on its side). */
export const insetLeft = (px: number) => plus('sal', px);
/** `px` of padding plus the right inset. */
export const insetRight = (px: number) => plus('sar', px);
