/**
 * Which public page an address draws (routes.ts › `site`): the configured
 * homepage at /{locale}/, any of the six designs as a landing page at
 * /{locale}/go/{name}, the host page, or a legal page — each in SiteLayout with
 * the header its design draws.
 */
import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { useSession } from '../hooks/useSession';
import { useRouter } from '../router';
import { paths } from '../routes';
import type { HomeDesign, Route } from '../routes';
import type { SitePageProps } from './page';
import { HOMEPAGE, SITE_PUBLIC } from './config';
import { SiteLayout, type HeaderStyle } from './SiteLayout';
import { W1Postcards } from './pages/home/W1Postcards';
import { W2Sorted } from './pages/home/W2Sorted';
import { W3Story } from './pages/home/W3Story';
import { W4Phone } from './pages/home/W4Phone';
import { W5Poster } from './pages/home/W5Poster';
import { W6Crew } from './pages/home/W6Crew';
import { HostLanding } from './pages/HostLanding';
import { LegalPage } from './pages/legal/LegalPage';

const DESIGNS: Record<HomeDesign, { Page: (p: SitePageProps) => React.ReactElement | null; header: HeaderStyle }> = {
  postcards: { Page: W1Postcards, header: { tone: 'cream', left: 'wordmark' } },
  sorted: { Page: W2Sorted, header: { tone: 'cream', left: 'wordmark' } },
  story: { Page: W3Story, header: { tone: 'lime', left: 'wordmark' } },
  phone: { Page: W4Phone, header: { tone: 'lime', float: true } },
  poster: { Page: W5Poster, header: { tone: 'lime', left: 'domain' } },
  crew: { Page: W6Crew, header: { tone: 'ink', left: 'wordmark' } },
};

export function SiteScreen({ route }: { route: Extract<Route, { name: 'site' }> }) {
  // While the launch gate is up the website is for signed-in people only (owner,
  // 2 Oct 2026: "The site doesn't go public until I've replaced the placeholder
  // privacy wording"). Somebody signed out goes to /login and comes straight
  // back; somebody signed in is never asked anything — no browser password
  // dialog, which a server-side check would have to raise. Nothing is drawn
  // until the API has said which.
  const { state, gate: asked } = useSession();
  // The server writes the gate into the page it sends; the API's answer wins once it arrives.
  const gate = asked ?? gateFromPage();
  const { href, navigate } = useRouter();
  const open = SITE_PUBLIC || gate === false || state === 'in' || state === 'unreachable';
  const refused = !SITE_PUBLIC && gate === true && state === 'out';
  useEffect(() => {
    if (refused) navigate(`${paths.login()}?next=${encodeURIComponent(href)}`, { replace: true });
  }, [refused, href, navigate]);
  if (!open) return null;
  return <SitePage route={route} />;
}

/** The gate as the server wrote it into this page's head, or null (the app shell, or native). */
function gateFromPage(): boolean | null {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  const v = document.querySelector('meta[name="epic-gate"]')?.getAttribute('content');
  return v === 'off' ? false : v === 'on' ? true : null;
}

function SitePage({ route }: { route: Extract<Route, { name: 'site' }> }) {
  const { locale, page } = route;
  if (page === 'home' || page === 'go') {
    const design = page === 'go' ? route.landing! : HOMEPAGE;
    const { Page, header } = DESIGNS[design];
    return (
      <SiteLayout locale={locale} header={header}>
        <Page locale={locale} landingPage={page === 'go' ? design : null} />
      </SiteLayout>
    );
  }
  if (page === 'host') {
    return (
      <SiteLayout locale={locale} header={{ tone: 'lime', left: 'wordmark', host: true }}>
        <HostLanding locale={locale} landingPage={null} />
      </SiteLayout>
    );
  }
  return (
    <SiteLayout locale={locale} header={{ tone: 'cream', left: 'wordmark' }}>
      <LegalPage locale={locale} page={page} />
    </SiteLayout>
  );
}
