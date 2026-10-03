/**
 * "Tell me when" at the bottom of a subcategory guide (brief §6a; Subcategory
 * guides, 3 Oct 2026): an email, a place (city, county or postcode), a radius
 * and a consent tick, then one button. The subcategory comes from the page.
 *
 *  - Checked on submit, one line under the button, in the brief's order: the
 *    email, then the place, then the tick.
 *  - On success the form is replaced by "Done. We'll email you when {pottery
 *    classes start} near {Place}." — the place as the API resolved it from
 *    Ordnance Survey / ONS names, or as typed if it could not.
 *  - A repeat is answered like a first sign-up, so the form never says who is
 *    already on it. A hidden honeypot catches bots, as on InterestForm.
 *
 * The tick is consent to marketing (UK PECR), so it is never pre-ticked, and
 * the sentence beside it is what is stored as the consent (guides › consentFor).
 * The radius is a native <select> and the tick a native checkbox on the web:
 * both keyboard-operable with a visible focus, as the acceptance asks.
 */
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { CREAM, INK, INK_FIELD, LIME, LIME_HOVER, ON_INK_LABEL, PLACEHOLDER_ON_INK, fonts } from '../theme';
import { api } from '../api';
import { useRouter } from '../router';
import { type SiteLocale } from '../routes';
import { consentFor, type Guide, type GuideSlug } from './guides';

const web = Platform.OS === 'web';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const RADII = [10, 15, 25, 50] as const;
/** The words the design gives each refusal, in the order they are checked. */
export const ALERT_ERRORS = {
  email: "That email doesn't look right.",
  place: 'Add a city, county or postcode.',
  consent: 'Tick the box so we can email you.',
  failed: "That didn't go through. Try again in a moment.",
} as const;

/** "reading" → "Reading", as the design echoes a place it could not look up. */
const titleCase = (t: string) => t.trim().replace(/\b\w/g, (c) => c.toUpperCase());

export function GuideAlertForm({ locale, slug, guide }: { locale: SiteLocale; slug: GuideSlug; guide: Guide }) {
  const { query, href } = useRouter();
  const [email, setEmail] = useState('');
  const [where, setWhere] = useState('');
  const [within, setWithin] = useState<number>(15);
  const [consent, setConsent] = useState(false);
  const [trap, setTrap] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [told, setTold] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const consentWording = consentFor(guide);

  const submit = async () => {
    if (busy) return;
    const e = email.trim();
    const w = where.trim();
    if (!EMAIL.test(e)) { setErr(ALERT_ERRORS.email); return; }
    if (!w) { setErr(ALERT_ERRORS.place); return; }
    if (!consent) { setErr(ALERT_ERRORS.consent); return; }
    setErr(null); setBusy(true);
    const q = (k: string) => query.get(k) || null;
    try {
      const r = await api.guideAlert({
        email: e, subcategory: slug, where: w, within, consent: true, consentWording, locale,
        pageUrl: web && typeof window !== 'undefined' ? `${window.location.origin}${href}` : href,
        referrer: web && typeof document !== 'undefined' ? document.referrer || null : null,
        utmSource: q('utm_source'), utmMedium: q('utm_medium'), utmCampaign: q('utm_campaign'),
        utmTerm: q('utm_term'), utmContent: q('utm_content'), gclid: q('gclid'), fbclid: q('fbclid'),
        website: trap,
      });
      setTold(r.place || titleCase(w));
    } catch (x: any) {
      // The API's own sentence for a refusal it explains (400); anything else is "try again".
      setErr(x?.status === 400 && typeof x?.body?.message === 'string' ? x.body.message : ALERT_ERRORS.failed);
    } finally { setBusy(false); }
  };

  if (told) {
    return (
      <View accessibilityLiveRegion="polite" {...(web ? ({ role: 'status' } as object) : {})}>
        <Text style={s.done}>{`Done. We'll email you when ${guide.short} near ${told}.`}</Text>
      </View>
    );
  }

  const field = (key: string) => [s.input, focus === key && web && ({ boxShadow: `inset 0 -3px 0 ${LIME}` } as object), web && ({ outlineWidth: 0 } as object)];
  const errId = `${slug}-alert-err`;
  const described = web && err ? ({ 'aria-describedby': errId } as object) : {};

  return (
    <View style={{ gap: 8 }}>
      <TextInput
        value={email}
        onChangeText={(t) => { setEmail(t); if (err) setErr(null); }}
        onFocus={() => setFocus('email')} onBlur={() => setFocus(null)}
        onSubmitEditing={submit}
        placeholder="Your email"
        placeholderTextColor={PLACEHOLDER_ON_INK}
        keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
        accessibilityLabel="Your email"
        {...(web ? ({ autoComplete: 'email', name: 'email' } as object) : {})}
        {...described}
        style={field('email')}
      />
      <View style={s.whereRow}>
        <TextInput
          value={where}
          onChangeText={(t) => { setWhere(t); if (err) setErr(null); }}
          onFocus={() => setFocus('where')} onBlur={() => setFocus(null)}
          onSubmitEditing={submit}
          placeholder="City, county or postcode"
          placeholderTextColor={PLACEHOLDER_ON_INK}
          autoCorrect={false}
          accessibilityLabel="City, county or postcode"
          {...(web ? ({ autoComplete: 'address-level2', name: 'where' } as object) : {})}
          {...described}
          style={[field('where'), { flexGrow: 1, flexShrink: 1, flexBasis: 200, minWidth: 0 }]}
        />
        <Within value={within} onChange={setWithin} />
      </View>
      {/* The honeypot: invisible to people and to screen readers, filled only by bots. */}
      <TextInput
        value={trap}
        onChangeText={setTrap}
        style={s.trap}
        {...(web ? ({ tabIndex: -1, 'aria-hidden': true, autoComplete: 'off', name: 'website' } as object) : {})}
      />
      <Consent checked={consent} onChange={(v) => { setConsent(v); if (err) setErr(null); }} label={consentWording} />
      <Pressable
        onPress={submit}
        disabled={busy}
        accessibilityRole="button"
        style={({ hovered }: any) => [s.button, { backgroundColor: hovered ? LIME_HOVER : LIME }]}
      >
        <Text style={s.buttonText}>Tell me when</Text>
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><Path d="M5 12h14M13 6l6 6-6 6" /></Svg>
      </Pressable>
      {err ? <Text nativeID={errId} accessibilityLiveRegion="polite" style={s.err}>{err}</Text> : null}
    </View>
  );
}

/** The radius: 10, 15, 25 or 50 miles, 15 unless changed. */
function Within({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  if (web) {
    return (
      <View style={s.selectWrap}>
        <select
          aria-label="Within"
          name="within"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="epic-guide-select"
          style={{
            width: '100%', height: 54, appearance: 'none', WebkitAppearance: 'none', border: 0, borderRadius: 0,
            background: INK_FIELD, padding: '0 40px 0 14px', fontFamily: fonts.heading, fontSize: 16, fontWeight: 600,
            color: CREAM, cursor: 'pointer',
          }}
        >
          {RADII.map((r) => <option key={r} value={r}>{r} miles</option>)}
        </select>
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={CREAM} strokeWidth={2.4} strokeLinecap="square" style={s.chevron as object}>
          <Path d="M6 9l6 6 6-6" />
        </Svg>
      </View>
    );
  }
  // Off the web (the site is drawn there only in development): the four as one row.
  return (
    <View style={[s.selectWrap, { flexDirection: 'row' }]}>
      {RADII.map((r) => (
        <Pressable key={r} onPress={() => onChange(r)} accessibilityRole="button" accessibilityState={{ selected: r === value }}
          style={{ flex: 1, height: 54, alignItems: 'center', justifyContent: 'center', backgroundColor: r === value ? LIME : INK_FIELD }}>
          <Text style={{ fontFamily: fonts.heading, fontWeight: '700', color: r === value ? INK : CREAM }}>{r}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** The consent tick: a real checkbox on the web, never pre-ticked. */
function Consent({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  if (web) {
    return (
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0 4px', cursor: 'pointer' }}>
        <input
          type="checkbox"
          name="consent"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ flex: 'none', width: 22, height: 22, margin: 0, accentColor: LIME, cursor: 'pointer' }}
        />
        <span style={{ fontFamily: fonts.body, fontSize: 15, lineHeight: 1.45, color: ON_INK_LABEL }}>{label}</span>
      </label>
    );
  }
  return (
    <Pressable onPress={() => onChange(!checked)} accessibilityRole="checkbox" accessibilityState={{ checked }} style={{ flexDirection: 'row', gap: 12, paddingTop: 10, paddingBottom: 4 }}>
      <View style={{ width: 22, height: 22, backgroundColor: checked ? LIME : CREAM }} />
      <Text style={[s.consent, { flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  input: { height: 54, backgroundColor: INK_FIELD, paddingHorizontal: 16, fontFamily: fonts.body, fontSize: 17, color: CREAM },
  whereRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  selectWrap: { flexGrow: 0, flexShrink: 1, flexBasis: 150, position: 'relative' },
  chevron: { position: 'absolute', right: 14, top: 19, pointerEvents: 'none' } as never,
  trap: { position: 'absolute', left: -10000, width: 1, height: 1, opacity: 0 },
  consent: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: CREAM },
  button: { height: 54, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  buttonText: { fontFamily: fonts.heading, fontSize: 17, fontWeight: '700', color: INK },
  err: { fontFamily: fonts.heading, fontSize: 15, fontWeight: '700', color: LIME },
  done: { fontFamily: fonts.heading, fontSize: 21, fontWeight: '700', lineHeight: 28, color: CREAM },
});
