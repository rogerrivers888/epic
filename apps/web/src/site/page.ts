import type { SiteLocale } from '../routes';

/**
 * What every public page component receives. The layout (header, footer, cookie
 * banner) is drawn around it by SiteLayout — a page draws only its own body.
 * `landingPage` is the `/go/{name}` it is being served as, or null at its own
 * address; forms pass it on so the waitlist knows which campaign page converted.
 */
export type SitePageProps = { locale: SiteLocale; landingPage: string | null };
