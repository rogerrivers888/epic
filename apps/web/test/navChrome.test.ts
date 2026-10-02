import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The home-screen chrome against the signed-off boards (New navigation 4a–4d,
 * Settings revised v2), measured from the markup rather than by eye. Read from
 * the source, as safeArea.test.ts does, because none of these render in node.
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the ink menu draws no rule between its cells (owner, 2 Oct 2026)', () => {
  const src = read('src/components/InkMenu.tsx');
  assert.ok(!/MENU_DIVIDER/.test(src), 'InkMenu still draws the divider');
  assert.ok(!/styles\.divider/.test(src), 'InkMenu still draws the divider');
});

test('the tall band is 22 + 44 + 26 under the status bar, with no extra 10px', () => {
  const src = read('src/components/Band.tsx');
  assert.match(src, /tallTop: \{ backgroundColor: LIME, paddingTop: \(Platform\.OS === 'web' \? 'max\(16px, var\(--epic-sat\)\)' : 16\)/);
  assert.match(src, /tallRow: \{[^}]*paddingTop: 22, paddingBottom: 26, minHeight: 92 \}/);
  // 40px type (38 × 1.05) in a 46px line, 3px of leading handed back each side.
  assert.match(src, /<Wordmark height=\{38\}/);
  assert.match(src, /tallMark: \{ marginVertical: -3 \}/);
});

test('Inspire section headings are sentence case at render', () => {
  const src = read('src/components/InspireBody.tsx');
  assert.match(src, /const heading = sentenceCase\(title\)/);
  assert.match(src, /<Text style=\{styles\.sectionTitle\}>\{heading\}<\/Text>/);
});

test('Trips calls finished trips "Been", as 4c does', () => {
  const src = read('src/screens/TripsList.tsx');
  assert.match(src, /<SectionHeader title="Been" count=\{past\.length\} \/>/);
  assert.ok(!/title="Past"/.test(src));
});

test('the tab bar puts 4px between icon and label, and keeps its tuned padding', () => {
  const app = read('App.tsx');
  assert.match(app, /tab: \{ flex: 1, minHeight: TARGET, alignItems: 'center', justifyContent: 'flex-start', gap: 4, paddingTop: 22 \}/);
});

test('the title band (Settings, Host) takes the same 14px trim: no extra 10px, 20 below', () => {
  const src = read('src/components/Band.tsx');
  assert.match(src, /export function TitleBand[\s\S]*?<View style=\{styles\.tallTop\}>/);
  assert.match(src, /titleRow: \{[^}]*paddingTop: 22, paddingBottom: 20 \}/);
});

test('on a phone the ink menu is 11px (≈2mm) taller: 21 above, 17 below', () => {
  const src = read('src/components/InkMenu.tsx');
  assert.match(src, /const phone = useViewport\(\)\.width < 900;/);
  assert.match(src, /cellPhone: \{ paddingTop: 21, paddingBottom: 17 \}/);
  assert.match(src, /cellFlatPhone: \{ paddingBottom: 20, borderBottomWidth: 0 \}/);
});
