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
  epic-wordmark-*.svg         the full wordmark on each ground

  The symbol and icon SVGs are pure vector with no font dependency. The
  wordmark SVGs set live text in Archivo, so open them online or install
  Archivo (Google Fonts, OFL); for anything that cannot load a font, render
  the component or use a PNG.

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

  At 16px the tile is dropped and the solid pin is used, because the hole
  closes into a smudge at that size.

HTML head snippet:
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">

retired-roam/
  The Roam mark and its lockups, kept as history. Nothing in the app reads
  from this folder.
