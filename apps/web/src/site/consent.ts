/**
 * Google Consent Mode v2 (Decisions J5–J6; owner, 1 Oct 2026: GA4 and Ads later).
 *
 * Nothing non-essential runs until the visitor says so (README › Cookies:
 * "Analytics and advertising tags load only after consent"): gtag.js is not
 * fetched, and nothing is configured, until there is a stored or fresh "Accept
 * all". Consent Mode v2 is set with every signal denied and then granted in the
 * same breath, so the tag never runs ahead of the choice; a later "Reject all"
 * in the same visit updates it back to denied (Codex, 1 Oct 2026 — loading the
 * tag denied would still send Google cookieless pings before anybody agreed).
 * The choice and the banner's version are kept for twelve
 * months; a new version asks again. With no GA4 or Ads ID nothing loads at all,
 * and there is no banner — there is nothing to consent to.
 */
import { Platform } from 'react-native';
import { GA4_ID, GOOGLE_ADS_ID, TRACKING_ON } from './config';

/** Bump when the categories or what they mean change, so everyone is asked again. */
export const CONSENT_VERSION = 1;
const COOKIE = 'epic_consent';
const YEAR = 60 * 60 * 24 * 365;

export type Consent = 'granted' | 'denied';
const web = Platform.OS === 'web' && typeof document !== 'undefined';

export function readConsent(): Consent | null {
  if (!web) return null;
  const raw = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  const value = raw ? decodeURIComponent(raw.slice(COOKIE.length + 1)) : '';
  const [v, choice] = value.split(':');
  return Number(v) === CONSENT_VERSION && (choice === 'granted' || choice === 'denied') ? choice : null;
}

export function writeConsent(choice: Consent): void {
  if (!web) return;
  document.cookie = `${COOKIE}=${encodeURIComponent(`${CONSENT_VERSION}:${choice}`)}; Max-Age=${YEAR}; Path=/; SameSite=Lax`;
  if (choice === 'granted') startTracking(); else applyConsent(choice);
}

type Gtag = (...args: unknown[]) => void;
const gtag = (): Gtag | null => (web ? ((window as unknown as { gtag?: Gtag }).gtag ?? null) : null);

function applyConsent(choice: Consent) {
  const v = choice === 'granted' ? 'granted' : 'denied';
  gtag()?.('consent', 'update', { ad_storage: v, analytics_storage: v, ad_user_data: v, ad_personalization: v });
}

let started = false;
/** Load gtag — only once the visitor has accepted. A no-op without IDs, or without a "granted". */
export function startTracking(): void {
  if (!web || started || !TRACKING_ON || readConsent() !== 'granted') return;
  started = true;
  const w = window as unknown as { dataLayer: unknown[]; gtag: Gtag };
  w.dataLayer = w.dataLayer || [];
  // eslint-disable-next-line prefer-rest-params
  w.gtag = function gtag() { w.dataLayer.push(arguments); };
  w.gtag('consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', wait_for_update: 500 });
  // Granted before anything is configured, so the first page view goes out
  // under the consent the visitor gave.
  applyConsent('granted');
  w.gtag('js', new Date());
  if (GA4_ID) w.gtag('config', GA4_ID);
  if (GOOGLE_ADS_ID) w.gtag('config', GOOGLE_ADS_ID);
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA4_ID || GOOGLE_ADS_ID)}`;
  document.head.appendChild(s);
}
