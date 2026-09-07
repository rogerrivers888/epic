import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Member, Visit } from '../api';
import { firstName, mean, verdictOf } from './verdict';
import { colors, radius, spacing, type } from '../theme';
import { Icon, Stars } from './Icon';
import { Row } from './ui';

/** A date the family would say out loud. */
const day = (iso?: string | null) =>
  (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'A visit');

/**
 * What this family made of this place, in one line (owner, 7 Sep 2026).
 *
 *   > "I feel like the review of the dishes should then blend into an overall
 *   > review from the family review stars. I can just see collapsed review
 *   > stars, and then I can expand it to see the meal."
 *
 * Every star the household has given here counts toward it: the ones given to
 * the place after a visit, and the ones given to the plates on the table. They
 * are the same act — somebody saying this was good — and keeping them in two
 * places meant a family who had starred six dishes still had no rating for the
 * restaurant. The arithmetic, and why it is that arithmetic, is in `verdict.ts`.
 */

/**
 * The collapsed line, and the meals behind it.
 *
 * Drawn only where there is something to draw: a place nobody has starred yet
 * says nothing at all rather than showing an empty five stars, which reads as
 * a rating of zero.
 */
export function FamilyVerdict({ visits, members, label = 'your family' }: { visits: Visit[]; members: Member[]; label?: string }) {
  const v = useMemo(() => verdictOf(visits, members), [visits, members]);
  const [open, setOpen] = useState(false);
  /**
   * Been, but nobody has said anything about it yet. The line still has to be
   * drawn — this is where the drawer says "you have been here", and a place you
   * have been to must not look like one you have not — but it is a fact, not a
   * rating, so it draws no stars and asks for nothing. The asking lives on the
   * Order tab, where the meal is.
   */
  if (v.score == null && !v.notGreat) {
    if (!visits.length) return null;
    const last = [...visits].sort((a, b) => String(b.visitedOn).localeCompare(String(a.visitedOn)))[0];
    return (
      <View style={styles.wrap}>
        <Row style={styles.head}>
          <Icon name="booked" size={17} />
          <View style={{ flex: 1 }}>
            <Text style={type.body}>You have been here</Text>
            <Text style={type.tiny}>
              {visits.length} {visits.length === 1 ? 'visit' : 'visits'}
              {last?.visitedOn ? ` · last on ${day(last.visitedOn)}` : ''} · nothing starred yet
            </Text>
          </View>
        </Row>
      </View>
    );
  }

  const rated = v.said.filter((s) => s.scores.length || s.notGreat.length);
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide what everyone said' : `Your family's rating${v.score != null ? `, ${v.score.toFixed(1)} out of 5` : ''} — see what everyone said`}
        style={styles.head}
      >
        {v.score != null ? <Stars value={v.score} size={17} /> : <Icon name="favourite" size={17} color={colors.inkFaint} />}
        <View style={{ flex: 1 }}>
          <Text style={type.body}>
            {v.score != null ? <Text style={{ fontWeight: '800' }}>{v.score.toFixed(1)}</Text> : 'Not for everyone'}
            <Text style={type.small}> · {label}</Text>
          </Text>
          <Text style={type.tiny}>
            {rated.map((s) => s.first).join(', ')} · {v.starsGiven} {v.starsGiven === 1 ? 'star' : 'stars'} across{' '}
            {v.meals.length} {v.meals.length === 1 ? 'meal' : 'meals'}
            {v.notGreat ? ` · ${v.notGreat} not great` : ''}
          </Text>
        </View>
        <Icon name={open ? 'collapse' : 'expand'} size={16} color={colors.inkMuted} />
      </Pressable>

      {open ? (
        <View style={styles.body}>
          {/* Each person's own number first: a family average is worth nothing
              if you cannot see that it is Phoenix's five and Gina's three. */}
          {rated.map((s) => {
            const own = mean(s.scores);
            return (
              <Row key={s.memberId} style={{ alignItems: 'center' }}>
                <View style={styles.face}><Text style={styles.faceText}>{s.first[0]?.toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={type.small}>{s.first}</Text>
                  <Text style={type.tiny}>
                    {s.plates ? `${s.plates} ${s.plates === 1 ? 'plate' : 'plates'} starred` : ''}
                    {s.plates && s.visitScores ? ' · ' : ''}
                    {s.visitScores ? 'rated the place' : ''}
                    {s.notGreat.length ? `${s.plates || s.visitScores ? ' · ' : ''}not great: ${s.notGreat.join(', ')}` : ''}
                  </Text>
                </View>
                {own != null ? <Stars value={own} size={13} /> : null}
              </Row>
            );
          })}

          {/* Then the meals themselves, most recent first. */}
          {v.meals.map((meal) => (
            <View key={meal.id} style={{ gap: 2 }}>
              <Text style={styles.when}>{day(meal.on)}</Text>
              {meal.lines.map((l, i) => (
                <Row key={i} style={{ alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={type.small}>{l.what}</Text>
                    <Text style={type.tiny}>
                      {l.who}
                      {l.notGreat ? ' · not great' : ''}
                      {l.comment ? ` — “${l.comment}”` : ''}
                    </Text>
                  </View>
                  {l.score != null ? <Stars value={l.score} size={12} /> : null}
                </Row>
              ))}
            </View>
          ))}
          <Text style={type.tiny}>
            Stars given to a plate and to the place both count; a plate nobody starred was fine and counts as nothing either way.
            Each person's stars average into their own, and the people into this one.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm },
  body: { gap: spacing.sm, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm },
  face: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  faceText: { fontSize: 11, fontWeight: '800', color: colors.primaryFg },
  when: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 1, fontWeight: '800', marginTop: spacing.xs },
});
