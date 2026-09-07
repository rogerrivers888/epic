/**
 * Every Epic brand asset, drawn from one definition.
 *
 * Run with `npm run brand`. It rewrites `docs/brand/svg/*`, the favicons and
 * app icons under `apps/web/public` and `apps/web/assets`, and the mark the
 * invitation e-mails use. Nothing here is hand-edited: if an icon looks wrong,
 * the fix belongs in this file.
 *
 * The pin is the one thing carried over from Roam, and the pack (§02) says so:
 * "It is Roam's pin, geometry unchanged." Note that the pack's own inline SVG
 * is *not* that — it is a redraw at 0.84 wide to tall, where the mark Roger
 * supplied measures 0.732 (traced from the logo in `Supporting docs/Rebrand -
 * EPIC`). The words win over the redraw: a squatter copy of the pin is a
 * different mark. `apps/web/src/components/Wordmark.tsx` draws the same path
 * live, and the two must not drift.
 *
 * Rasterising is done by headless Chrome because it is the only thing on the
 * machine that can, and because the wordmark sets live text in Archivo — which
 * means a browser has to be the one to lay it out.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.EPIC_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// The palette, from docs/brand/README.txt.
const LIME = '#C8F542', INK = '#201E1D', CREAM = '#FFFDF9';

// Roam's pin. The viewBox is cropped to the ink, so a height maps onto it directly.
const PIN_PATH = 'M24 2C13 2 5 10.5 5 21c0 13 19 33 19 33s19-20 19-33C43 10.5 35 2 24 2z';
const VB = { x: 5, y: 2, w: 38, h: 52 };
const ASPECT = VB.w / VB.h;              // 0.731
const HOLE = { cx: 24, cy: 21, r: 7 };
/** The pin with the hole cut out of the path, so whatever is behind shows through. */
const PIN_HOLED = `${PIN_PATH} M${HOLE.cx} ${HOLE.cy - HOLE.r} a${HOLE.r} ${HOLE.r} 0 1 0 0.01 0 Z`;

const r = (n, p = 3) => Number(n.toFixed(p));
const hole = (fill) => `<circle cx="${HOLE.cx}" cy="${HOLE.cy}" r="${HOLE.r}" fill="${fill}"/>`;

/** The pin inside a `size` square, at `scale` of the square's height. */
function placed(size, scale, ink, ground) {
  const h = size * scale, w = h * ASPECT, s = h / VB.h;
  // The pin's mass sits above its point, so centring the box drops it low.
  const x = (size - w) / 2 - VB.x * s;
  const y = (size - h) / 2 - size * 0.02 - VB.y * s;
  return `<g transform="translate(${r(x)} ${r(y)}) scale(${r(s, 5)})"><path d="${PIN_PATH}" fill="${ink}"/>${ground ? hole(ground) : ''}</g>`;
}

/**
 * A square app icon: a flat ground, the pin, and the hole in the ground's
 * colour. `solid` drops the hole for the 16px tile, where it closes to a smudge
 * — the tile itself stays, because a bare ink pin disappears into Chrome's dark
 * tab strip.
 */
const icon = ({ size = 512, ground = LIME, ink = INK, scale = 0.62, border = null, solid = false } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`
  + `<rect width="${size}" height="${size}" fill="${ground}"/>`
  + (border ? `<rect x="1" y="1" width="${size - 2}" height="${size - 2}" fill="none" stroke="${border}" stroke-width="2"/>` : '')
  + placed(size, scale, ink, solid ? null : ground) + `</svg>\n`;

/** The pin alone, cropped to its ink. `hole` null draws it solid, for small sizes. */
const symbol = ({ size = 100, ink = INK, ground = null } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" width="${Math.round(size * ASPECT)}" height="${size}">`
  + `<path d="${PIN_PATH}" fill="${ink}"/>${ground ? hole(ground) : ''}</svg>\n`;

/**
 * The wordmark: "Epic" in Archivo 800 at -0.06em, the pin as the dot of the
 * dotless i. The metrics are measured in a browser, not derived from glyph
 * advances — advances put the pin a stem's width right of the letter and clip
 * the c. `ground` null cuts a real hole in the pin instead of painting one.
 */
function wordmark({ height = 120, ink = INK, ground = CREAM, word = 'Epic', bg = null } = {}) {
  const fs = height, TRACK = -0.06;
  const PIN_H = 0.30, PIN_W = PIN_H * ASPECT;       // the pin's height is what §03 calls x
  const M = word === 'Epic' ? { inkW: 2.011, iCentre: 1.326 } : { inkW: 1.931, iCentre: 1.246 };
  const CAP_TOP = -0.88, INK_H = 1.09, GAP = 0.05;  // ink box and the pin's clearance, in ems
  const pad = PIN_H * fs;
  const pinTop = CAP_TOP - GAP - PIN_H;
  const w = (M.inkW + PIN_H * 2) * fs;
  const h = (CAP_TOP + INK_H - pinTop + PIN_H * 2) * fs;
  const baseline = (PIN_H - pinTop) * fs;
  const s = PIN_H * fs / VB.h;
  const px = pad + (M.iCentre + 0.03 - PIN_W / 2) * fs - VB.x * s;   // §01's 0.03em nudge
  const py = baseline + pinTop * fs - VB.y * s;
  const font = `Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r(w)} ${r(h)}" width="${r(w)}" height="${r(h)}">`
    + (bg ? `<rect width="${r(w)}" height="${r(h)}" fill="${bg}"/>` : '')
    + `<text x="${r(pad)}" y="${r(baseline)}" font-family="${font}" font-weight="800" font-size="${fs}" letter-spacing="${r(TRACK * fs)}" fill="${ink}">${word === 'Epic' ? 'Ep' : 'ep'}ıc</text>`
    + `<g transform="translate(${r(px)} ${r(py)}) scale(${r(s, 5)})">`
    + (ground === null ? `<path d="${PIN_HOLED}" fill="${ink}" fill-rule="evenodd"/>` : `<path d="${PIN_PATH}" fill="${ink}"/>${hole(ground)}`)
    + `</g></svg>\n`;
}

/**
 * The tab icon and the app icon are supplied art, not drawn here.
 *
 * The handoff ships them (`Logo - Chrome icons/assets`) and is specific about
 * why: the tab icon is a full-bleed lime tile with the ink pin and **no hole**,
 * because at 16px the hole closes up and the mark reads as a blob — and the
 * bare pin on a transparent ground "renders as the browser's default-looking
 * black location marker", which is exactly what it was doing. So these are
 * copied in and rasterised rather than generated, and the pin inside them is
 * the handoff's own, at its own inset.
 */
const SUPPLIED = ['epic-favicon-lime.svg', 'epic-favicon-ink.svg', 'epic-app-icon.svg'];

const SVGS = {
  'epic-icon-lime.svg': icon({}),
  'epic-icon-ink.svg': icon({ ground: INK, ink: LIME }),
  'epic-icon-cream.svg': icon({ ground: CREAM, border: INK }),
  'epic-icon-maskable.svg': icon({ scale: 0.48 }),
  'epic-icon-lime-solid.svg': icon({ solid: true }),
  'epic-android-foreground.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="432" height="432">${placed(108, 0.46, INK, LIME)}</svg>\n`,
  'epic-symbol-ink.svg': symbol({ ground: CREAM }),
  'epic-symbol-lime.svg': symbol({ ink: LIME, ground: INK }),
  'epic-symbol-solid.svg': symbol({}),
  'epic-wordmark-ink-on-lime.svg': wordmark({ ground: LIME, bg: LIME }),
  'epic-wordmark-ink-on-cream.svg': wordmark({ bg: CREAM }),
  'epic-wordmark-lime-on-ink.svg': wordmark({ ink: LIME, ground: INK, bg: INK }),
  'epic-wordmark-transparent.svg': wordmark({ ground: null }),
};

/** Shoot an SVG at exactly w x h device pixels. `alpha` keeps the ground clear. */
function raster(svg, out, w, h, alpha = false) {
  const page = join(ROOT, 'node_modules', '.cache-epic-brand.html');
  mkdirSync(dirname(page), { recursive: true });
  /**
   * Size the *svg element*, not whatever carries the first `width=` in the file.
   *
   * The supplied icons open `<svg viewBox="0 0 100 100">` with no size of their
   * own and a full-bleed `<rect width="100" height="100">` inside; replacing the
   * first match resized the rect and left the canvas alone, which drew the tile
   * at 16px with the pin still 100 units across. Setting them on the opening tag
   * is unambiguous whether or not the file already has them.
   */
  const sized = svg
    .replace(/\s(width|height)="[^"]*"(?=[^>]*>)/g, (m, a, o, str) => (str.slice(0, o).lastIndexOf('<svg') > str.slice(0, o).lastIndexOf('>') ? '' : m))
    .replace('<svg', `<svg width="${w}" height="${h}"`);
  writeFileSync(page, '<!doctype html><meta charset="utf-8">'
    + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@800&display=swap">'
    + `<style>html,body{margin:0;line-height:0;background:${alpha ? 'transparent' : '#fff'}}</style>${sized}`);
  mkdirSync(dirname(out), { recursive: true });
  execFileSync(CHROME, ['--headless', '--disable-gpu', '--hide-scrollbars',
    ...(alpha ? ['--default-background-color=00000000'] : []),
    `--window-size=${w},${h}`, `--screenshot=${out}`, '--virtual-time-budget=8000', `file://${page}`], { stdio: 'pipe' });
}

const svgPath = (n) => join(ROOT, 'docs/brand/svg', n);
mkdirSync(join(ROOT, 'docs/brand/svg'), { recursive: true });
for (const [name, body] of Object.entries(SVGS)) writeFileSync(svgPath(name), body);
console.log(`${Object.keys(SVGS).length} SVGs written to docs/brand/svg (${SUPPLIED.length} more are the handoff's own, left as supplied)`);

const S = (n) => readFileSync(svgPath(n), 'utf8');
const square = (n) => (out, size) => raster(S(n), join(ROOT, out), size, size);
const limeTile = square('epic-icon-lime.svg');

// The tab icon, at every size a browser asks for, from the supplied tile.
const favicon = square('epic-favicon-lime.svg');
for (const [out, size] of [['apps/web/public/favicon-16.png', 16], ['apps/web/public/favicon-32.png', 32],
  ['apps/web/public/favicon-48.png', 48], ['apps/web/public/favicon-192.png', 192],
  ['apps/web/public/favicon-512.png', 512], ['apps/web/assets/favicon.png', 48]]) favicon(out, size);
// The dark-tab alternative, offered to Chrome by `media` in index.html.
square('epic-favicon-ink.svg')('apps/web/public/favicon-dark-32.png', 32);
// The home-screen icon keeps its hole: it is never seen at 16px.
square('epic-app-icon.svg')('apps/web/public/apple-touch-icon.png', 180);
square('epic-app-icon.svg')('apps/web/assets/icon.png', 1024);
square('epic-icon-maskable.svg')('apps/web/public/favicon-maskable-512.png', 512);
raster(S('epic-symbol-ink.svg'), join(ROOT, 'apps/web/assets/splash-icon.png'), Math.round(512 * ASPECT), 512, true);
raster(S('epic-symbol-ink.svg'), join(ROOT, 'apps/web/assets/brand/epic-symbol-light.png'), Math.round(512 * ASPECT), 512, true);
raster(S('epic-android-foreground.svg'), join(ROOT, 'apps/web/assets/android-icon-foreground.png'), 432, 432, true);
// The mark the invitation e-mails put on the lime band: 2x, transparent, holed.
const wm = S('epic-wordmark-transparent.svg');
const box = wm.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
raster(wm, join(ROOT, 'apps/web/public/brand/epic-wordmark-ink.png'), 300, Math.round(300 * (+box[2] / +box[1])), true);
writeFileSync(join(ROOT, 'apps/web/public/favicon.svg'), S('epic-favicon-lime.svg'));
writeFileSync(join(ROOT, 'apps/web/public/favicon-dark.svg'), S('epic-favicon-ink.svg'));

// favicon.ico: 16/32/48 as PNGs in an ICO container, which every current browser reads.
const imgs = [16, 32, 48].map((s) => ({ s, buf: readFileSync(join(ROOT, `apps/web/public/favicon-${s}.png`)) }));
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
let offset = 6 + imgs.length * 16;
const dir = [], body = [];
for (const { s, buf } of imgs) {
  const e = Buffer.alloc(16);
  e[0] = s; e[1] = s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(offset, 12);
  dir.push(e); body.push(buf); offset += buf.length;
}
writeFileSync(join(ROOT, 'apps/web/public/favicon.ico'), Buffer.concat([head, ...dir, ...body]));
console.log('icons, favicon.ico and the e-mail mark rebuilt');
