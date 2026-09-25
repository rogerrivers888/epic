# The text drawers re-fenced by type: before and after (25 Sep 2026)

Owner: "Map each to its real Google type … then drop the bare-text query. Report the before and after count per drawer so I can see what the text was inflating."

Run `2411c144` over the 40 areas, 452 tiles (448 fresh, re-opened for the changed drawers only): 12,001 requests, 5,994 places, 0 saturated, ledger $0.00 (11,994 Essentials rows), 1.5 h. Found by fenced words: 5,178 places across 12 drawers; by type: 831.

Before is the national distinct-place count per drawer captured before the re-fencing (`2026-09-25-text-sourced.json`), of which text. After is what counts now: places found by a typed rule or a fenced word question. Text rows are kept on the places (`found_by = text`) and no longer count.

| drawer | before | of which text | after | by type | by fenced words | text rows kept |
|---|---:|---:|---:|---:|---:|---:|
| historic-houses | 8,159 | 8,159 | 1,367 | 0 | 1,367 | 6,953 |
| football | 6,232 | 6,232 | 393 | 0 | 393 | 5,952 |
| off-road | 2,310 | 2,269 | 41 | 41 | 0 | 2,269 |
| rugby-cricket | 3,057 | 3,057 | 2,283 | 0 | 2,283 | 1,575 |
| lidos | 1,987 | 1,987 | 505 | 0 | 505 | 1,572 |
| caves-falls | 1,585 | 1,585 | 391 | 0 | 391 | 1,293 |
| ancient-sites | 1,394 | 1,394 | 529 | 0 | 529 | 996 |
| circuits | 500 | 500 | 123 | 0 | 123 | 386 |
| skateboard-park | 998 | 376 | 627 | 618 | 0 | 376 |
| indoor-snow | 180 | 178 | 15 | 15 | 0 | 171 |
| ski-resort | 140 | 125 | 15 | 15 | 0 | 125 |
| paintball-lasertag | 341 | 173 | 235 | 197 | 38 | 109 |
| scenic | 76 | 76 | 0 | 0 | 0 | 76 |
| days-out | 0 | 0 | 0 | 0 | 0 | 0 |

Ski resort and Scenic have no question: their old rows stop counting as their tiles pass out of the freshness window. On the outcode board most of the fenced finds sit in the unresolved column for now, because the 40-area run asks at the 8 km grid and an unsaturated question there is an 8 km box; they resolve where the ground is censused at a kilometre.

