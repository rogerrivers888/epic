import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../press';
import { colors, fonts, BORDER, TARGET } from '../../theme';
import { Icon, IconName } from '../Icon';
import { ChatSheet } from './ChatSheet';

/**
 * The reaction picker (E3).
 *
 * Six on one tap in the top row — 😂 ❤️ 👍 🙏 😮 😢 — then the person's own
 * most-used (the common set until they have some), then search and the
 * standard groups. Long-press a message to open it; tap a reaction that is
 * already there to add yours.
 *
 * No artwork of our own: the platform's emoji font draws these — Apple Color
 * Emoji on iOS, Noto on Android, whatever the browser has on the web. Epic's
 * job is the picker and the ordering (README §6).
 */

type Group = { key: string; icon: IconName; label: string; emoji: string[] };

/** The standard groups, compact: enough to find the ordinary ones by eye or by word. */
const GROUPS: Group[] = [
  { key: 'smileys', icon: 'emoji', label: 'Smileys', emoji: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😋', '😛', '🤪', '🤔', '🤨', '😐', '😶', '🙄', '😏', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🥵', '🥶', '😵', '🤯', '🥳', '😎', '🤓', '😕', '😟', '🙁', '😮', '😲', '😳', '🥺', '😢', '😭', '😱', '😖', '😤', '😡', '🤬', '😈', '💀', '💩', '🤡', '👻', '👽', '🤖'] },
  { key: 'people', icon: 'person', label: 'People', emoji: ['👍', '👎', '👏', '🙌', '🙏', '🤝', '👋', '✌️', '🤞', '🤟', '👌', '🤌', '👈', '👉', '👆', '👇', '☝️', '✋', '💪', '🦵', '👀', '👁️', '🧠', '🙋', '🙋‍♀️', '🙋‍♂️', '🤷', '🤷‍♀️', '🤷‍♂️', '🤦', '💁', '🙆', '🙅', '👶', '🧒', '👦', '👧', '🧑', '👨', '👩', '🧓', '👴', '👵', '👪', '💃', '🕺', '🚶', '🏃', '🧘', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '❣️', '💕', '💖', '💗', '💯', '💥', '💫', '💦', '💨'] },
  { key: 'nature', icon: 'zoo', label: 'Animals and nature', emoji: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦆', '🦅', '🦉', '🐺', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐢', '🐍', '🐙', '🦀', '🐠', '🐟', '🐬', '🐳', '🦈', '🐊', '🐘', '🦒', '🐑', '🐐', '🐕', '🐈', '🌸', '🌼', '🌻', '🌹', '🌷', '🌳', '🌲', '🌴', '🌵', '🍀', '🍁', '🍂', '🍄', '🌍', '🌙', '⭐', '🌟', '☀️', '⛅', '🌧️', '⛈️', '🌈', '❄️', '🔥', '🌊'] },
  { key: 'food', icon: 'restaurant', label: 'Food and drink', emoji: ['🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🥑', '🥦', '🥕', '🌽', '🥔', '🧄', '🧅', '🍞', '🥐', '🥖', '🥨', '🧀', '🥚', '🍳', '🥞', '🥓', '🍗', '🍖', '🌭', '🍔', '🍟', '🍕', '🌮', '🌯', '🥗', '🍝', '🍜', '🍣', '🍱', '🥟', '🍦', '🍰', '🎂', '🧁', '🍪', '🍫', '🍬', '☕', '🍵', '🧃', '🥤', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧊'] },
  { key: 'activity', icon: 'sport', label: 'Activities', emoji: ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏉', '🎱', '🏓', '🏸', '🥅', '⛳', '🏹', '🎣', '🥊', '⛸️', '🎿', '🛷', '🏂', '🏋️', '🤸', '⛹️', '🤺', '🏊', '🚣', '🧗', '🚴', '🏇', '🎯', '🎮', '🎲', '🧩', '🎭', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🎻', '🎪', '🎟️', '🎫', '🏆', '🥇', '🥈', '🥉', '🏅', '🎉', '🎊', '🎈', '🎁', '🎀'] },
  { key: 'travel', icon: 'driving', label: 'Travel and places', emoji: ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🚚', '🚜', '🛵', '🏍️', '🚲', '🛴', '🚂', '🚆', '🚇', '🚊', '🚉', '✈️', '🛫', '🛬', '🚁', '⛵', '🚤', '🛳️', '⛴️', '🚀', '🛸', '🗺️', '🧭', '🏔️', '⛰️', '🌋', '🏕️', '🏖️', '🏜️', '🏝️', '🏞️', '🏟️', '🏛️', '🏗️', '🏘️', '🏠', '🏡', '🏢', '🏨', '🏪', '🏫', '🏥', '🏦', '⛪', '🕌', '🗼', '🗽', '⛲', '⛺', '🌁', '🌃', '🌄', '🌅', '🌆', '🌇', '🌉', '🎡', '🎢', '🎠', '🧳', '📸'] },
  { key: 'objects', icon: 'info', label: 'Objects', emoji: ['⌚', '📱', '💻', '⌨️', '🖥️', '🖨️', '📷', '📹', '🎥', '📞', '☎️', '📺', '📻', '⏰', '⏳', '⌛', '📡', '🔋', '🔌', '💡', '🔦', '🕯️', '🧯', '💸', '💵', '💳', '🧾', '💎', '🔧', '🔨', '🛠️', '🧲', '🧪', '🧬', '🔬', '🔭', '💊', '🩹', '🧹', '🧺', '🧻', '🧼', '🛒', '🚪', '🛏️', '🛋️', '🪑', '🚽', '🚿', '🛁', '🧴', '🔑', '🗝️', '🎁', '📦', '📫', '📝', '📖', '📚', '📌', '📍', '🔒', '🔓', '🧭', '🎒', '👓', '🧢', '👟', '🥾', '☂️'] },
  { key: 'symbols', icon: 'question', label: 'Symbols', emoji: ['✅', '❌', '❓', '❗', '‼️', '⁉️', '💤', '🔔', '🔕', '⚠️', '🚫', '♻️', '✔️', '➕', '➖', '➗', '✖️', '💲', '💱', '©️', '®️', '™️', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛', '⬜', '🔶', '🔷', '▪️', '▫️', '🔺', '🔻', '💠', '🔘', '🏁', '🚩', '🎌', '🏳️', '🏴', '⏩', '⏪', '⏫', '⏬', '▶️', '⏸️', '⏹️', '⏺️', '🔀', '🔁', '🔂', '🔼', '🔽', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '🔄', '🆗', '🆕', '🆓', '🔝', '🔚'] },
];

/** A few words per emoji, for search. Not every one — the groups are for browsing; search is for the ones people type. */
const WORDS: Record<string, string> = {
  '😂': 'laugh joy funny crying', '❤️': 'love heart red', '👍': 'thumbs up yes good ok like', '🙏': 'thanks please pray hands', '😮': 'wow surprised open mouth', '😢': 'sad tear cry',
  '😭': 'sob cry', '🤣': 'rofl laugh', '😍': 'love eyes heart', '🥰': 'love adore', '😎': 'cool sunglasses', '🤔': 'think hmm', '👀': 'eyes look', '✅': 'tick check done yes', '❌': 'cross no wrong',
  '🙋': 'hand raise me question', '🍝': 'pasta spaghetti', '🍷': 'wine', '🍺': 'beer', '☀️': 'sun sunny', '🌊': 'wave sea beach', '🚗': 'car drive', '⛰️': 'mountain', '📸': 'camera photo', '💯': 'hundred perfect',
  '🔥': 'fire hot lit', '🎉': 'party celebrate', '👏': 'clap applause', '🙌': 'hooray hands', '🤩': 'star struck excited', '😅': 'sweat phew', '🎂': 'cake birthday', '☕': 'coffee', '🍕': 'pizza', '🍔': 'burger',
  '✈️': 'plane flight fly', '🚂': 'train', '⛵': 'boat sail', '🏖️': 'beach', '🏕️': 'camp tent', '🧳': 'luggage suitcase', '🗺️': 'map', '💤': 'sleep zzz', '⏰': 'alarm clock time', '🔔': 'bell',
  '🌧️': 'rain', '❄️': 'snow cold', '🌈': 'rainbow', '🐶': 'dog', '🐱': 'cat', '🐝': 'bee', '🦋': 'butterfly', '🌸': 'flower blossom', '🌻': 'sunflower', '💪': 'strong muscle', '🤝': 'handshake deal',
  '👋': 'wave hello bye', '🤷': 'shrug dunno', '🤦': 'facepalm', '😴': 'sleep tired', '🤢': 'sick', '😱': 'scream', '😡': 'angry', '🥳': 'party', '🎁': 'gift present', '🏆': 'trophy win', '⚽': 'football',
  '🎾': 'tennis', '🏊': 'swim', '🚴': 'bike cycle', '🎸': 'guitar', '🎤': 'sing karaoke', '💡': 'idea bulb', '📍': 'pin place', '🔑': 'key', '🚪': 'door', '🛏️': 'bed hotel', '🍻': 'cheers beers',
  '🥂': 'cheers champagne', '🍦': 'ice cream', '🍰': 'cake', '🧀': 'cheese', '🥐': 'croissant', '🍞': 'bread', '🥗': 'salad', '🍣': 'sushi', '🍜': 'noodles ramen', '⚠️': 'warning', '❓': 'question',
};

export function ReactionPicker({ quick, mostUsed, yours, onPick, onClose }: {
  quick: string[];
  mostUsed: string[];
  /** Whether `mostUsed` is the person's own history yet, or the common set. */
  yours: boolean;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<string | null>(null);

  const found = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return null;
    const all = GROUPS.flatMap((g) => g.emoji);
    return all.filter((e) => (WORDS[e] ?? '').includes(needle) || e === needle).slice(0, 48);
  }, [q]);

  const shown = found ?? (group ? GROUPS.find((g) => g.key === group)?.emoji ?? [] : null);

  return (
    <ChatSheet onClose={onClose}>
      <View style={styles.wrap}>
        {/* Six in the top row are the whole point: one tap, no search. */}
        <View style={styles.quickBand}>
          {quick.map((e) => (
            <Press key={e} onPress={() => onPick(e)} accessibilityRole="button" accessibilityLabel={`React ${e}`} style={styles.quick}>
              <Text style={styles.quickText}>{e}</Text>
            </Press>
          ))}
        </View>

        {shown ? (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.kicker}>{found ? (found.length ? 'FOUND' : 'NOTHING BY THAT NAME') : GROUPS.find((g) => g.key === group)?.label.toUpperCase()}</Text>
            </View>
            <View style={styles.grid}>
              {shown.map((e, i) => (
                <Press key={`${e}-${i}`} onPress={() => onPick(e)} accessibilityRole="button" accessibilityLabel={`React ${e}`} style={styles.cell}>
                  <Text style={styles.cellText}>{e}</Text>
                </Press>
              ))}
            </View>
          </View>
        ) : (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.kicker}>{yours ? 'YOURS, MOST USED' : 'MOST USED ON EPIC'}</Text>
              {!yours ? <Text style={styles.hint}>Yours first, once you have some</Text> : null}
            </View>
            <View style={styles.grid}>
              {mostUsed.map((e, i) => (
                <Press key={`${e}-${i}`} onPress={() => onPick(e)} accessibilityRole="button" accessibilityLabel={`React ${e}`} style={styles.cell}>
                  <Text style={styles.cellText}>{e}</Text>
                </Press>
              ))}
            </View>
          </View>
        )}

        <View style={styles.search}>
          <Icon name="search" size={16} color={colors.inkMuted} />
          <TextInput
            value={q}
            onChangeText={(v) => { setQ(v); if (v) setGroup(null); }}
            placeholder="Search all emoji"
            placeholderTextColor={colors.inkMuted}
            style={styles.searchField}
            accessibilityLabel="Search all emoji"
          />
          {q ? <Press onPress={() => setQ('')} accessibilityRole="button" accessibilityLabel="Clear"><Icon name="close" size={14} color={colors.inkMuted} /></Press> : null}
        </View>

        <View style={styles.groups}>
          <Press onPress={() => { setGroup(null); setQ(''); }} accessibilityRole="button" accessibilityLabel="Most used" style={[styles.groupBtn, !group && !q && styles.groupOn]}>
            <Icon name="hours" size={18} color={!group && !q ? colors.selectedFg : colors.inkMuted} />
          </Press>
          {GROUPS.map((g) => (
            <Press key={g.key} onPress={() => { setGroup(g.key); setQ(''); }} accessibilityRole="button" accessibilityLabel={g.label} style={[styles.groupBtn, group === g.key && styles.groupOn]}>
              <Icon name={g.icon} size={18} color={group === g.key ? colors.selectedFg : colors.inkMuted} />
            </Press>
          ))}
        </View>
      </View>
    </ChatSheet>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  quickBand: { flexDirection: 'row', gap: 6, backgroundColor: colors.surfaceMuted, padding: 6 },
  quick: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lime },
  quickText: { fontSize: 28, lineHeight: 34 },
  section: { gap: 6 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  kicker: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.88, color: colors.ink },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '12.5%', minHeight: TARGET, alignItems: 'center', justifyContent: 'center' },
  cellText: { fontSize: 24, lineHeight: 30 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, minHeight: 40, backgroundColor: colors.warm },
  searchField: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.ink, minHeight: 40 },
  groups: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: BORDER, borderTopColor: colors.line, paddingTop: 6 },
  groupBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  groupOn: { backgroundColor: colors.selected },
});
