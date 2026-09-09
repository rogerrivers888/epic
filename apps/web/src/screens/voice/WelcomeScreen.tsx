/**
 * First run (C0): two doors. **Plan something now** dominates; "Set up my
 * family first · 2 min" is sold on its payoff and sized as a secondary line.
 * Trial users must reach a plan within a minute.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { Press } from '../../components/press';
import { paths } from '../../routes';
import { useRouter } from '../../router';
import { PrimaryCta, VoiceScreen } from '../../components/voice/kit';
import { Wordmark } from '../../components/Wordmark';
import { colors, fonts } from '../../theme';

export const WELCOMED_KEY = 'epic.voice.welcomed';
export const markWelcomed = () => { try { localStorage.setItem(WELCOMED_KEY, 'yes'); } catch { /* noop */ } };
export const wasWelcomed = () => { try { return localStorage.getItem(WELCOMED_KEY) === 'yes'; } catch { return true; } };

export function WelcomeScreen() {
  const { navigate } = useRouter();
  return (
    <VoiceScreen>
      <View style={{ paddingTop: 16, minHeight: 40 }}><Wordmark height={30} ground={colors.bg} /></View>
      <View style={{ flex: 1 }} />
      <Text style={styles.big}>Plan less.{'\n'}Live more.</Text>
      <Text style={styles.body}>Tell Epic what you fancy and it plans the day — travel, timings and food included.</Text>
      <View style={{ gap: 10, marginTop: 8 }}>
        <PrimaryCta label="Plan something now" onPress={() => { markWelcomed(); navigate(paths.say(), { replace: true }); }} />
        <Press onPress={() => { markWelcomed(); navigate(paths.setup(), { replace: true }); }} accessibilityRole="button" style={styles.second}>
          <Text style={styles.secondText}>Set up my family first</Text>
          <Text style={[styles.secondText, { fontWeight: '500' }]}>2 min</Text>
        </Press>
      </View>
    </VoiceScreen>
  );
}

const styles = {
  big: { fontFamily: fonts.heading, fontSize: 38, fontWeight: '800' as const, letterSpacing: -1.5, lineHeight: 40, color: colors.ink },
  body: { fontSize: 16, lineHeight: 24, color: colors.inkMuted },
  second: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, paddingVertical: 12, paddingHorizontal: 2 },
  secondText: { fontSize: 14, fontWeight: '600' as const, color: colors.inkMuted },
};
