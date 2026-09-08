Epic brand pack — v1, September 2026
Source of truth: "Supporting docs/Rebrand - EPIC/Epic Brand Pack.dc.html"

THE MARK
  One wordmark. "Epic" set in Archivo 800 at -0.06em, with the pin as the dot
  of the i — centred on the stem, its point just clear of the letter, which is
  why the i is the dotless U+0131. The pin is always the same colour as the
  letters; only the hole takes the background. There is no symbol-plus-wordmark
  lockup and the pin never sits beside the word: the word is the logo.

  Camel-case "Epic" is primary. All-lowercase "epic" is the approved alternate
  for casual, in-app moments.

  Clear space: x = the height of the pin, on every side.
  Minimum size: 24px on screen, 8mm in print. Below that, use the pin alone.

  In the app the mark is not a file — it is drawn live by
  apps/web/src/components/Wordmark.tsx (Wordmark, Pin, PinMark, Lockup), so it
  is sharp at any size and takes whichever palette is on.

COLOUR
  Lime       #C8F542   oklch(0.90 0.20 125)   brand, fields, selection
  Ink        #201E1D                          type, rules, the pin
  Cream      #FFFDF9                          reading ground, cards, the hole
  Lime tint  #EAFECB   oklch(0.97 0.07 125)   UI only — hover, soft panels
  Moss       #446B00   oklch(0.48 0.13 130)   UI only — links, small green text

  Ink on lime is 13.1:1 and ink on cream 16.3:1 — use them for anything.
  Never set cream or white type on lime; it is 1.25:1 and fails at every size.
  Lime type only ever sits on ink.
  Roam red is retired. The one thing that stays red is meaning, not brand:
  allergen and overrun warnings (owner, 7 Sep 2026).

TYPE
  Archivo, one family, three weights, everything flush left.
    Display  800  -0.04em
    Heading  800  -0.02em
    Label    600   0.08em, caps
    Body     400   16/1.5
  Caveat is gone. There is no second face.

STRAPLINE
  "Seize the day" is primary and the only line locked to the logo.
  Campaign lines, headlines only: "Plan less. Live more." · "Make every minute
  count" · "Make it happen".

IN THE PRODUCT
  Cream ground, ink type, 2px ink rules. Lime is the header, the primary action
  and the moment something is selected. Square corners throughout, no shadows.
  Selected = lime fill with ink type. Hover = lime tint.

DON'T
  Cream type on lime · recolour the pin · put the pin beside the word ·
  stretch, shadow or rotate the mark.

FILES
svg/
  epic-icon-lime.svg          app icon, primary — ink pin on lime
  epic-icon-ink.svg           app icon, reverse — lime pin on ink
  epic-icon-cream.svg         app icon, outlined on cream
  epic-icon-maskable.svg      PWA maskable (pin inside the safe zone)
  epic-android-foreground.svg Android adaptive foreground, transparent
  epic-symbol-ink.svg         the pin alone, ink with a cream hole
  epic-symbol-lime.svg        the pin alone, lime with an ink hole
  epic-symbol-solid.svg       the pin alone, no hole — for use below 24px
  epic-icon-lime-solid.svg    lime tile, solid pin — the pack lists it; nothing
                              in the app uses it (see the note under the icons)
  epic-favicon-lime.svg       the tab tile: ink pin, holed, at 0.82 of the tile
  epic-favicon-ink.svg        the same for a dark tab strip
  epic-wordmark-*.svg         the full wordmark on each ground; the
                              `-transparent` one cuts the pin's hole out of the
                              path, so whatever is behind shows through it

  The symbol and icon SVGs are pure vector with no font dependency. The
  wordmark SVGs set live text in Archivo, so open them online or install
  Archivo (Google Fonts, OFL); for anything that cannot load a font, render
  the component or use a PNG.

  Their geometry is measured, not derived: Archivo 800 at -0.06em gives an ink
  box of 2.011em ("Epic") or 1.931em ("epic"), and the dotless i's own centre
  sits at 1.326em / 1.246em from the text origin — which is where the pin goes,
  plus the pack's 0.03em nudge. Deriving those from glyph advances puts the pin
  a stem's width to the right and clips the c.

Generated icons live beside the app, not here:
  apps/web/public/favicon.ico            16 + 32 + 48
  apps/web/public/favicon.svg            scalable, preferred by modern browsers
  apps/web/public/favicon-16/32/48.png
  apps/web/public/favicon-192/512.png    PWA manifest
  apps/web/public/favicon-maskable-512.png
  apps/web/public/apple-touch-icon.png   180
  apps/web/assets/icon.png               1024, master for iOS/Android
  apps/web/assets/android-icon-foreground.png
  apps/web/assets/splash-icon.png
  apps/web/public/brand/epic-wordmark-ink.png   the mark for e-mail: 2x,
        transparent, holed. `apps/api/src/sources/mail.js` puts it on the lime
        band, with "Epic" as its alt text for the inboxes that block images.

  The tab icon keeps its hole at every size. The pack (§04) says to drop it —
  "at 16px the hole closes up and the mark reads as a blob" — and that was
  followed until 8 Sep 2026, when Roger said the Chrome icon "doesn't look
  anything like a pin". Rendered side by side at 16, 20, 24 and 32px the hole
  holds at all of them, and it is the *solid* pin that reads as a blob. The
  pack's other two points do hold and are kept: the tile stays full-bleed lime,
  because an ink pin on nothing disappears into Chrome's dark tab strip and
  reads as the browser's own location marker; and the ink tile is offered to
  dark tab strips through `media`.

  In the app, `Pin` cuts the hole at every size too (owner, 8 Sep 2026: "Yes
  hole that also!"). The pack's "drop it below 24px" is not followed anywhere:
  the wordmark's dot never did, on his instruction of 7 Sep, and the tab icon
  settled it at 16px. `Pin`'s `hole` prop still exists for a caller that wants
  the solid pin, and `epic-symbol-solid.svg` / `epic-icon-lime-solid.svg` are
  still written out because the pack lists them; nothing in the app uses either.

  None of these are drawn by hand. `npm run brand` rewrites every one of them
  from `scripts/brand.mjs`, which holds the pin path, the palette and the
  wordmark metrics in one place. If an icon looks wrong, fix it there.

  THE PIN. It is Roam's, geometry unchanged, exactly as §02 of the pack says.
  Be aware that the pack's own inline SVG is not that: it is a redraw at 0.84
  wide to tall, where the mark Roger supplied measures 0.732. The words win
  over the redraw — the pin is the one thing carried over from Roam, and a
  squatter copy of it is a different mark.

HTML head snippet:
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">

retired-roam/
  The Roam mark and its lockups, kept as history. Nothing in the app reads
  from this folder.
