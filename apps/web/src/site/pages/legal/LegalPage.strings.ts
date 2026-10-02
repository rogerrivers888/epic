import type { Strings } from '../../i18n';

type Legal = { title: string; sections: { heading: string; body: string }[] };
/** The two short pages; terms, privacy and cookies are full documents (legalDocs.ts). */
type LegalPages = Record<'accessibility' | 'contact', Legal>;

/**
 * Terms, privacy and cookies are the owner's legal pack (legalDocs.ts; owner,
 * 2 Oct 2026); these two short pages are the rest (owner: "a short accessibility
 * statement … and the contact page with support@epic.day").
 */
const GB: LegalPages = {
  accessibility: {
    title: 'Accessibility',
    sections: [
      { heading: 'Our aim', body: 'We build epic.day to meet WCAG 2.2 at level AA: readable type, enough contrast, everything usable with a keyboard and a screen reader, and pages that work at any size from a phone up.' },
      { heading: 'Tell us', body: 'If anything on epic.day stops you doing what you came to do, email support@epic.day and tell us what happened and where. We will reply and fix it.' },
    ],
  },
  contact: {
    title: 'Contact',
    sections: [{ heading: 'Email', body: 'support@epic.day' }, { heading: 'Post', body: 'MAKE IT EPIC LIMITED, 124 City Road, London EC1V 2NX' }],
  },
};

export const LEGAL_STRINGS: Strings<LegalPages> = { 'en-gb': GB, 'en-us': GB };
