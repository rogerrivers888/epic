import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The safe area is read in exactly one place.
 *
 * This exists because a double-counted inset survived four rounds of fixing.
 * react-native-web's `SafeAreaView` pads all four edges by the safe area
 * itself, so wrapping the app in one and then adding an inset inside it counts
 * the same space twice — a band of dead app above the wordmark and below the
 * tab bar. It hid because the component builds its `env(...)` string at runtime
 * out of two halves: it is not in the bundle to be grepped for or substituted,
 * and `env()` is nought in a headless browser, so the fault existed only on a
 * real phone.
 *
 * Two rules keep it dead, and both are checked by reading the source rather
 * than by rendering, because rendering is exactly what could not see it:
 *
 *   1. Nothing imports `SafeAreaView`.
 *   2. `env(safe-area-inset-*)` appears only in `index.html`, where it is
 *      assigned to `--epic-sat` / `--epic-sab`. Everything else asks for the
 *      variable — which is also what makes an inset overridable in a test.
 */

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const SOURCES = [
  'App.tsx', 'index.ts',
  'src/components/InspireHeader.tsx', 'src/components/BottomSheet.tsx',
  'src/components/MapGL.web.tsx', 'src/screens/TripMapScreen.tsx',
];

test('nothing imports SafeAreaView: it pads all four edges by itself', () => {
  for (const f of SOURCES) {
    const src = read(f);
    const imports = src.split('\n').filter((l) => l.startsWith('import') && l.includes('SafeAreaView'));
    assert.deepEqual(imports, [], `${f} imports SafeAreaView — it would add a second inset on a real phone`);
  }
});

test('env(safe-area-inset-*) is read in index.html and nowhere else', () => {
  for (const f of SOURCES) {
    assert.ok(!/env\(safe-area-inset/.test(read(f)),
      `${f} reads env(safe-area-inset-…) directly; use var(--epic-sat) / var(--epic-sab) so there is one source of truth`);
  }
  const html = read('public/index.html');
  assert.match(html, /--epic-sat:\s*env\(safe-area-inset-top\)/);
  assert.match(html, /--epic-sab:\s*env\(safe-area-inset-bottom\)/);
});

test('the two ends of the app each apply the inset once', () => {
  const app = read('App.tsx');
  // The frame adds a top inset only when the screen does not draw its own head,
  // and a bottom inset only when there is no tab bar to carry it.
  assert.match(app, /ownHeader \? null : \{ paddingTop: 'var\(--epic-sat\)'/);
  assert.match(app, /ownFooter \? null : \{ paddingBottom: 'var\(--epic-sab\)'/);
  // And the tab bar is the thing that carries it when there is one.
  assert.match(app, /paddingBottom: \(Platform\.OS === 'web' \? 'max\(8px, var\(--epic-sab\)\)'/);
  // Inspire draws its own head, so it takes the top inset itself.
  assert.match(read('src/components/InspireHeader.tsx'), /max\(16px, calc\(var\(--epic-sat\) \+ 10px\)\)/);
});
