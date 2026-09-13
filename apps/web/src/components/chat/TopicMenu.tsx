import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Press } from '../press';
import { colors, fonts, BORDER, TARGET } from '../../theme';
import { Icon, IconName } from '../Icon';
import { ChatMenuGroup } from '../../api';
import { ChatSheet } from './ChatSheet';

/**
 * The ellipsis (E2), grouped by who can do it: everyone gets follow, copy link
 * and who-has-seen-it; the asker can edit the question; the organiser or host
 * can mark the answer and pin it. Report sits at the bottom, in red — the one
 * red thing here, because it means something is wrong rather than brand.
 *
 * The groups come from the API (`domain/chat.js menuFor`), so a guest on the
 * link is handed the first group only and never sees a control they cannot
 * use.
 */

const ICON: Record<string, IconName> = {
  follow: 'bell', unfollow: 'bellOff', link: 'link', seen: 'preview', edit: 'reply', answer: 'check', pin: 'pinned', unpin: 'pinned',
};

export function TopicMenu({ groups, onPick, onClose }: {
  groups: ChatMenuGroup[];
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <ChatSheet onClose={onClose}>
      <View style={styles.box}>
        {groups.map((g) => (
          <View key={g.title}>
            <View style={styles.groupHead}><Text style={styles.groupTitle}>{g.title.toUpperCase()}</Text></View>
            {g.items.map((it) => (
              <Press key={it.key} onPress={() => onPick(it.key)} accessibilityRole="menuitem" style={styles.item}>
                <View style={styles.itemIcon}><Icon name={ICON[it.key] ?? 'more'} size={18} color={colors.ink} strokeWidth={2} /></View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={styles.itemLabel}>{it.label}</Text>
                  {it.hint ? <Text style={styles.itemHint}>{it.hint}</Text> : null}
                </View>
              </Press>
            ))}
          </View>
        ))}
        <Press onPress={() => onPick('report')} accessibilityRole="menuitem" style={styles.item}>
          <View style={styles.itemIcon}><Icon name="flag" size={18} color={colors.overrun} strokeWidth={2} /></View>
          <Text style={[styles.itemLabel, { color: colors.overrun }]}>Report this</Text>
        </Press>
      </View>
    </ChatSheet>
  );
}

const styles = StyleSheet.create({
  box: { marginHorizontal: 16, marginTop: 12, borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface },
  groupHead: { backgroundColor: colors.warm, paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  groupTitle: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.88, color: colors.inkMuted },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: TARGET, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  itemIcon: { width: 22, alignItems: 'center' },
  itemLabel: { fontFamily: fonts.heading, fontSize: 15, fontWeight: '700', color: colors.ink },
  itemHint: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkMuted, lineHeight: 17 },
});
