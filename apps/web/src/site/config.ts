/**
 * The website's switches — each one value, so a decision is a one-line change.
 */
import type { HomeDesign } from '../routes';

/**
 * Which of W1–W6 renders at /{locale}/ — W3, "The story in four" (owner, 2 Oct
 * 2026: "Switch to W3 … We want the full page, basically"; it replaced W2). The
 * others run as noindex landing pages at /{locale}/go/{name}.
 */
export const HOMEPAGE: HomeDesign = 'story';

/**
 * The website is published on its own, ahead of the app (owner, 2 Oct 2026:
 * "publish it as soon as you're ready"): drawn for everybody whatever the launch
 * gate says. The server reads the same switch from seo.json › public, and
 * test/site.test.ts keeps the two in step. false puts it back behind a sign-in.
 */
export const SITE_PUBLIC = true;

/** The footer's small print (owner, 1 Oct 2026). */
export const COMPANY = {
  name: 'MAKE IT EPIC LIMITED',
  number: '17445225',
  office: '124 City Road, London EC1V 2NX',
} as const;

/**
 * GA4 and Google Ads, both later (owner, 1 Oct 2026). Unset means no tracking —
 * and with no tracking there is nothing to consent to, so no banner and no
 * "Cookie settings" link. Public by definition (EXPO_PUBLIC_*), never a secret.
 */
export const GA4_ID = process.env.EXPO_PUBLIC_GA4_ID || '';
export const GOOGLE_ADS_ID = process.env.EXPO_PUBLIC_GOOGLE_ADS_ID || '';
export const TRACKING_ON = Boolean(GA4_ID || GOOGLE_ADS_ID);
