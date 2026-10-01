import type { Strings } from '../../i18n';
import type { SitePageName } from '../../../routes';

type Legal = { title: string; sections: { heading: string; body: string }[] };
type LegalPages = Record<Exclude<SitePageName, 'host'>, Legal>;

/**
 * Placeholder wording (owner, 1 Oct 2026: "Add /en-gb/privacy with placeholder
 * text; I'll supply the final wording"). It says what is true today — what the
 * waitlist keeps and why — so the form can link to it before launch; the final
 * notice replaces these words, not the page.
 */
const GB: LegalPages = {
  privacy: {
    title: 'Privacy notice',
    sections: [
      { heading: 'Who we are', body: 'Epic is run by MAKE IT EPIC LIMITED (company no. 17445225), 124 City Road, London EC1V 2NX.' },
      { heading: 'What we keep when you register your interest', body: 'Your email address, which page and campaign you signed up from, the country your connection came from, and the words on the button you pressed. If you told us what you would host, we keep that too.' },
      { heading: 'What we do with it', body: 'We email you when the app is out — and, if you signed up as a host, before launch. Nothing else, and we never sell it.' },
      { heading: 'Taking it back', body: 'Email hello@epic.day and we will delete your sign-up from the list and every export.' },
      { heading: 'This notice', body: 'This is an interim notice while Epic is not yet open. The full privacy notice will replace it before launch.' },
    ],
  },
  terms: {
    title: 'Terms',
    sections: [{ heading: 'Before launch', body: 'Epic is not open yet. These terms will be published here before it is.' }],
  },
  cookies: {
    title: 'Cookies',
    sections: [
      { heading: 'What we use now', body: 'Only the essential cookies that keep epic.day working and remember your choices.' },
      { heading: 'Analytics and advertising', body: 'If we add Google analytics or advertising cookies, we will ask you first, and nothing will be set unless you accept.' },
    ],
  },
  accessibility: {
    title: 'Accessibility',
    sections: [{ heading: 'Our aim', body: 'We build epic.day to WCAG 2.2 AA. If anything stops you using it, email hello@epic.day and tell us.' }],
  },
  contact: {
    title: 'Contact',
    sections: [{ heading: 'Email', body: 'hello@epic.day' }, { heading: 'Post', body: 'MAKE IT EPIC LIMITED, 124 City Road, London EC1V 2NX' }],
  },
};

export const LEGAL_STRINGS: Strings<LegalPages> = { 'en-gb': GB, 'en-us': GB };
