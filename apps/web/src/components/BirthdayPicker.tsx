/**
 * A date of birth, in three taps: the year, then the month, then the day.
 *
 * Owner, 12 Sep 2026: "If you're ever going to ask someone's date of birth,
 * you should have a calendar picker. It should ask for the year you were born
 * first, and then the month, and then the date. It should be a 3-step process
 * and very easy and straightforward."
 *
 * Year first, because it is the one a month grid gets wrong: somebody born in
 * 1976 should not page back six hundred months. The decade row narrows the
 * years to ten boxes, the months are twelve, the days are at most thirty-one,
 * and each step is one screen of boxes on a 390px phone. The value in and out
 * is `YYYY-MM-DD`, which is what the API stores; nothing is typed.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Press } from './press';
import { colors, fonts, spacing, TARGET, BORDER, type } from '../theme';
import { Icon } from './Icon';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m: number) => new Date(y, m, 0).getDate();

/** "24 November 1976", or nothing for nothing. */
export function birthdayWords(iso?: string | null): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function BirthdayPicker({ value, onChange, label = 'Date of birth', hint, clearable = true, minAge = 0, maxAge = 110 }: {
  value: string | null;
  onChange: (iso: string | null) => void;
  label?: string;
  hint?: string;
  /** Offer "No birthday" — for a household member it is optional. */
  clearable?: boolean;
  /** Youngest and oldest the picker offers: a host is 18+, a child can be 0. */
  minAge?: number;
  maxAge?: number;
}) {
  const thisYear = new Date().getFullYear();
  const latest = thisYear - minAge;
  const earliest = thisYear - maxAge;
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState<number | null>(value ? Number(value.slice(0, 4)) : null);
  const [month, setMonth] = useState<number | null>(value ? Number(value.slice(5, 7)) : null);
  const [decade, setDecade] = useState<number>(() => Math.floor((value ? Number(value.slice(0, 4)) : latest - 30) / 10) * 10);
  const step: 1 | 2 | 3 = year == null ? 1 : month == null ? 2 : 3;
  const words = birthdayWords(value);

  const decades: number[] = [];
  for (let d = Math.floor(latest / 10) * 10; d >= Math.floor(earliest / 10) * 10; d -= 10) decades.push(d);
  const years = Array.from({ length: 10 }, (_, i) => decade + i).filter((y) => y >= earliest && y <= latest);

  const start = () => { setYear(null); setMonth(null); setOpen(true); };
  const pickDay = (d: number) => { onChange(`${year}-${pad(month!)}-${pad(d)}`); setOpen(false); };

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.label}>{label}</Text>
      {!open ? (
        <Press onPress={start} accessibilityRole="button" accessibilityLabel={words ? `${label}: ${words}. Change it` : `Pick ${label.toLowerCase()}`} style={styles.summary}>
          <Icon name="calendar" size={16} color={colors.ink} />
          <Text style={[type.h3, { flex: 1 }, !words && { color: colors.inkMuted, fontWeight: '400' }]}>{words ?? 'Tap to pick — year, then month, then day'}</Text>
          <Text style={styles.link}>{words ? 'Change' : 'Pick'}</Text>
        </Press>
      ) : (
        <View style={styles.sheet}>
          {/* Where you are in the three: the answers so far, each a way back. */}
          <View style={styles.crumbs}>
            <Press onPress={() => { setYear(null); setMonth(null); }} accessibilityRole="button" style={[styles.crumb, step === 1 && styles.crumbOn]}><Text style={[styles.crumbText, step === 1 && styles.crumbTextOn]}>{year ?? 'Year'}</Text></Press>
            <Icon name="more" size={12} color={colors.inkMuted} />
            <Press onPress={() => { if (year != null) setMonth(null); }} accessibilityRole="button" style={[styles.crumb, step === 2 && styles.crumbOn]}><Text style={[styles.crumbText, step === 2 && styles.crumbTextOn]}>{month != null ? SHORT[month - 1] : 'Month'}</Text></Press>
            <Icon name="more" size={12} color={colors.inkMuted} />
            <View style={[styles.crumb, step === 3 && styles.crumbOn]}><Text style={[styles.crumbText, step === 3 && styles.crumbTextOn]}>Day</Text></View>
            <View style={{ flex: 1 }} />
            <Press onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}><Icon name="close" size={16} color={colors.inkMuted} /></Press>
          </View>

          {step === 1 ? (
            <>
              <Text style={styles.question}>Which year were you born?</Text>
              <View style={styles.decades}>
                {decades.map((d) => (
                  <Press key={d} onPress={() => setDecade(d)} accessibilityRole="button" accessibilityState={{ selected: d === decade }} style={[styles.decade, d === decade && styles.boxOn]}>
                    <Text style={[styles.decadeText, d === decade && styles.boxTextOn]}>{d}s</Text>
                  </Press>
                ))}
              </View>
              <View style={styles.grid}>
                {years.map((y) => (
                  <Press key={y} onPress={() => setYear(y)} accessibilityRole="button" style={styles.box}><Text style={styles.boxText}>{y}</Text></Press>
                ))}
              </View>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <Text style={styles.question}>Which month, in {year}?</Text>
              <View style={styles.grid}>
                {MONTHS.map((m, i) => (
                  <Press key={m} onPress={() => setMonth(i + 1)} accessibilityRole="button" style={styles.box}><Text style={styles.boxText}>{SHORT[i]}</Text></Press>
                ))}
              </View>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <Text style={styles.question}>Which day, in {MONTHS[month! - 1]} {year}?</Text>
              <View style={styles.grid}>
                {Array.from({ length: daysIn(year!, month!) }, (_, i) => i + 1).map((d) => (
                  <Press key={d} onPress={() => pickDay(d)} accessibilityRole="button" style={styles.dayBox}><Text style={styles.boxText}>{d}</Text></Press>
                ))}
              </View>
            </>
          ) : null}

          {clearable && value ? (
            <Press onPress={() => { onChange(null); setOpen(false); }} accessibilityRole="button" style={{ paddingVertical: 6 }}><Text style={styles.link}>No birthday</Text></Press>
          ) : null}
        </View>
      )}
      {hint ? <Text style={type.tiny}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.ink },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: TARGET, paddingHorizontal: spacing.md, borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface },
  link: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.accent },
  sheet: { gap: spacing.sm, padding: spacing.md, borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface },
  crumbs: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  crumb: { paddingHorizontal: 8, height: 26, justifyContent: 'center', backgroundColor: colors.warm },
  crumbOn: { backgroundColor: colors.selected },
  crumbText: { fontFamily: fonts.body, fontSize: 12, fontWeight: '700', color: colors.inkMuted },
  crumbTextOn: { color: colors.selectedFg },
  question: { fontFamily: fonts.heading, fontSize: 17, fontWeight: '800', color: colors.ink, letterSpacing: -0.3 },
  decades: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  decade: { paddingHorizontal: 10, height: 32, justifyContent: 'center', borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface },
  decadeText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.ink },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // Five across at 390px, four boxes of years and months to a row, seven days.
  box: { width: '30%', flexGrow: 1, height: TARGET, alignItems: 'center', justifyContent: 'center', borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface },
  dayBox: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface },
  boxOn: { backgroundColor: colors.selected, borderColor: colors.ink },
  boxText: { fontFamily: fonts.heading, fontSize: 16, fontWeight: '800', color: colors.ink },
  boxTextOn: { color: colors.selectedFg },
});
