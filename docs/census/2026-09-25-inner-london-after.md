# Inner London at a kilometre: after (25 Sep 2026)

Run `f378dc4f` — 346 tiles at 0.01° × 0.015° (about 1.1 × 1.0 km), padding 1 km, 136 outcodes. Started 24 Sep 07:41 UTC, finished 25 Sep 09:39 UTC (26 h of clock, one quota day lost to the 00:00 UTC wake-up).

| | |
|---|---|
| Requests | 104,807 |
| Places | 45,313 (distinct) |
| Slices | 103,585, of which 279 hit the 60 ceiling and were split into 1,116 children; none left saturated at the floor |
| Ledger | 21,572 rows, all Essentials, $0.00 |
| Found by | type 42,735 · words 326 · text 5,077 |


Rolled up under the centre rule (93a2ecd) and the one-pass roll-up (0b87036): 136 outcodes, 7,628 rows, 1,296 places counted in a district their tile was not tagged with.


## Before and after, per outcode

Before is the deployed board on 24 Sep 08:40 (`2026-09-24-inner-london-before.json`), corner test on the 8 km census. After is the same board on 25 Sep after the re-census and the roll-up above. Unresolved is a floor bucket: a wide box across several districts is in each of their columns, so the column does not sum to places.

| outcode | before | unresolved | after | unresolved |
|---|---:|---:|---:|---:|
| SE1 | 178 | 2646 | 1181 | 2906 |
| NW1 | 106 | 1516 | 978 | 2175 |
| E1 | 116 | 4118 | 927 | 2494 |
| W1D | 22 | 358 | 829 | 0 |
| SE10 | 83 | 7657 | 855 | 5112 |
| W1T | 25 | 1140 | 672 | 1198 |
| E14 | 65 | 1060 | 585 | 1612 |
| N1 | 6 | 1613 | 495 | 1484 |
| SW19 | 39 | 324 | 517 | 930 |
| SW6 | 46 | 400 | 473 | 1224 |
| EC2A | 1 | 227 | 399 | 349 |
| E8 | 14 | 899 | 409 | 1613 |
| W2 | 148 | 3751 | 539 | 2127 |
| W1K | 2 | 140 | 385 | 0 |
| WC2E | 0 | 269 | 372 | 0 |
| EC1Y | 0 | 470 | 369 | 1369 |
| WC2N | 3 | 374 | 363 | 2 |
| N17 | 45 | 396 | 404 | 1015 |
| EC4V | 0 | 135 | 350 | 0 |
| EC3N | 1 | 1085 | 338 | 1197 |
| W1B | 1 | 240 | 324 | 258 |
| E2 | 10 | 678 | 328 | 1708 |
| WC1N | 0 | 168 | 318 | 947 |
| WC2A | 2 | 290 | 315 | 221 |
| W1J | 3 | 2389 | 315 | 1711 |
| WC2H | 0 | 927 | 305 | 442 |
| SW17 | 43 | 384 | 345 | 1105 |
| SE18 | 20 | 2417 | 307 | 2053 |
| NW10 | 33 | 824 | 308 | 1487 |
| W4 | 49 | 334 | 319 | 914 |
| W1U | 4 | 1975 | 269 | 1057 |
| SW7 | 10 | 1377 | 258 | 1143 |
| SW1P | 1 | 132 | 247 | 232 |
| SW16 | 2 | 806 | 247 | 1254 |
| W1G | 0 | 131 | 245 | 0 |
| SW11 | 40 | 1138 | 275 | 1821 |
| EC2V | 14 | 206 | 247 | 2 |
| WC1A | 3 | 61 | 236 | 0 |
| NW3 | 48 | 5017 | 278 | 2098 |
| E13 | 92 | 654 | 320 | 674 |
| WC2R | 3 | 1142 | 231 | 1237 |
| W12 | 34 | 7951 | 260 | 4805 |
| EC1R | 0 | 0 | 221 | 3 |
| EC1M | 0 | 0 | 216 | 0 |
| SW3 | 7 | 593 | 223 | 1107 |
| SW1Y | 1 | 208 | 210 | 0 |
| SE5 | 20 | 687 | 226 | 1850 |
| E17 | 163 | 4071 | 368 | 5369 |
| GU1 | 100 | 836 | 299 | 602 |
| W6 | 3 | 337 | 199 | 978 |
| W5 | 23 | 1031 | 211 | 1144 |
| GU2 | 11 | 72 | 198 | 340 |
| N12 | 22 | 144 | 209 | 486 |
| W3 | 1 | 15 | 188 | 746 |
| W1H | 6 | 235 | 190 | 955 |
| W1F | 5 | 424 | 188 | 0 |
| W11 | 23 | 1611 | 201 | 1111 |
| EC4R | 31 | 1004 | 203 | 1218 |
| N22 | 0 | 3523 | 165 | 4471 |
| SE15 | 14 | 353 | 178 | 1000 |
| SE20 | 0 | 2542 | 164 | 1822 |
| W8 | 14 | 183 | 177 | 1164 |
| EC1V | 1 | 333 | 159 | 1406 |
| W1S | 1 | 835 | 158 | 247 |
| SE7 | 0 | 195 | 155 | 257 |
| SW9 | 10 | 217 | 160 | 1356 |
| N7 | 1 | 294 | 150 | 559 |
| N4 | 27 | 1590 | 164 | 1550 |
| SW15 | 2 | 8999 | 137 | 4381 |
| N16 | 1 | 779 | 135 | 1468 |
| SE9 | 3 | 281 | 136 | 611 |
| E20 | 3 | 202 | 134 | 1125 |
| EC1N | 0 | 450 | 126 | 983 |
| SE23 | 3 | 1328 | 125 | 692 |
| SW1V | 0 | 686 | 116 | 1163 |
| SW1H | 4 | 571 | 117 | 961 |
| SW5 | 1 | 271 | 112 | 657 |
| WC2B | 0 | 250 | 108 | 0 |
| SE25 | 4 | 168 | 108 | 444 |
| SE8 | 20 | 863 | 119 | 920 |
| SW4 | 10 | 1212 | 104 | 1373 |
| NW6 | 18 | 129 | 111 | 1065 |
| NW2 | 4 | 505 | 96 | 724 |
| NW5 | 5 | 278 | 96 | 827 |
| W1W | 15 | 225 | 106 | 0 |
| SW8 | 1 | 289 | 91 | 1962 |
| SE11 | 0 | 1643 | 88 | 1480 |
| NW7 | 1 | 195 | 83 | 269 |
| SW1W | 0 | 52 | 81 | 0 |
| SW1X | 3 | 2852 | 82 | 939 |
| SW1E | 1 | 92 | 78 | 0 |
| E5 | 0 | 6498 | 76 | 2303 |
| NW9 | 0 | 3423 | 76 | 4663 |
| W7 | 1 | 2671 | 72 | 6073 |
| E15 | 0 | 118 | 69 | 378 |
| SW2 | 0 | 9759 | 68 | 3211 |
| SE21 | 2 | 89 | 69 | 760 |
| E16 | 1 | 333 | 67 | 412 |
| N8 | 1 | 90 | 66 | 812 |
| WC1E | 0 | 9 | 64 | 0 |
| NW11 | 0 | 55 | 59 | 221 |
| SW10 | 1 | 7983 | 59 | 812 |
| SW20 | 0 | 70 | 57 | 457 |
| W14 | 4 | 125 | 58 | 1017 |
| SW1A | 0 | 624 | 52 | 554 |
| WC1B | 3 | 9890 | 51 | 2848 |
| EC4M | 0 | 255 | 35 | 294 |
| NW8 | 1 | 371 | 33 | 1006 |
| N19 | 0 | 68 | 29 | 440 |
| NW4 | 0 | 23 | 29 | 157 |
| W1C | 0 | 293 | 26 | 0 |
| W9 | 0 | 0 | 17 | 140 |
| W10 | 1 | 584 | 10 | 881 |
| N15 | 3 | 1080 | 10 | 1089 |
| SE19 | 0 | 132 | 5 | 513 |
| SW18 | 0 | 104 | 5 | 1032 |
| SE22 | 3 | 1018 | 6 | 1029 |
| N6 | 0 | 781 | 2 | 869 |
| SW13 | 0 | 2129 | 2 | 810 |
| WC1X | 0 | 25 | 2 | 240 |
| SE14 | 0 | 89 | 1 | 592 |
| SE16 | 2 | 7462 | 3 | 2120 |
| W13 | 1 | 68 | 2 | 559 |
| E3 | 0 | 158 | 0 | 1044 |
| E9 | 0 | 1008 | 0 | 1482 |
| N20 | 0 | 202 | 0 | 268 |
| N5 | 0 | 102 | 0 | 536 |
| SE24 | 0 | 84 | 0 | 802 |
| SE27 | 0 | 0 | 0 | 379 |
| SE28 | 0 | 1975 | 0 | 5826 |
| SW12 | 1 | 26 | 1 | 582 |
| SW14 | 0 | 199 | 0 | 478 |
| WC1H | 0 | 0 | 0 | 0 |
| E10 | 30 | 1208 | 9 | 1181 |

134 outcodes · counted 1,950 → 26,596 · unresolved 162,653 → 152,631


### What still reads low, and why

73 of the 136 outcodes have one or two sectors in `geo_cells`. The centre rule places a box by the nearest sector *point*, so a district drawn as one point loses its ground to neighbours drawn as six or eight: WC1H has two sectors 45 m apart at Euston and counts 0 with 145 fine-box places within 300 m of them, all nearest an NW1 or WC1E sector. Nine outcodes read 0 for this reason (E3, E9, N20, N5, SE24, SE27, SE28, SW14, WC1H). This is a sector-table question, not a roll-up one; a fuller sector list for London is the fix.

The unresolved column is places whose narrowest box is still wider than a kilometre: 49,026 distinct places overlap inner London that way, almost all from the 8 km census of the surrounding ground, whose tiles reach into these outcodes with padding. They resolve when their own ground is censused at a kilometre.


## Text-sourced drawers, all categories

Drawers with any place found by a bare text query, after the re-census. `rules` is the drawer's row count in `shelf_rules`; `places` is distinct places in `place_subcategories`; `text` is those found by a bare text query. Owner (24 Sep 2026): "Do not delete anything; I will judge them."

| category | drawer | rules | places | text | % text |
|---|---|---:|---:|---:|---:|
| culture | historic-houses | 8 | 8,159 | 8,159 | 100 |
| sport | football | 3 | 6,232 | 6,232 | 100 |
| sport | rugby-cricket | 6 | 3,057 | 3,057 | 100 |
| adrenaline | off-road | 2 | 2,310 | 2,269 | 98 |
| fun | lidos | 2 | 1,987 | 1,987 | 100 |
| outdoors | caves-falls | 3 | 1,585 | 1,585 | 100 |
| culture | ancient-sites | 3 | 1,394 | 1,394 | 100 |
| adrenaline | circuits | 4 | 500 | 500 | 100 |
| sport | skateboard-park | 3 | 998 | 376 | 37 |
| adrenaline | indoor-snow | 2 | 180 | 178 | 98 |
| adrenaline | paintball-lasertag | 3 | 341 | 173 | 50 |
| sport | ski-resort | 0 | 140 | 125 | 89 |
| relaxing | scenic | 0 | 76 | 76 | 100 |
