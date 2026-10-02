# The homepage's photos — placeholders

Every picture on the homepage (`src/site/pages/home/W3Story.tsx`, the v3 design
approved 2 Oct 2026) is an **Unsplash placeholder**, downloaded and served by us
rather than hot-linked, so the page costs no third-party request. The handoff
says to swap them for licensed or our own photography **before launch**; doing
so is a matter of dropping new files in under the same names (or editing the
paths in `W3Story.tsx`).

The Unsplash Licence allows free commercial use with no attribution required;
the credits are kept here so the next person knows where each one came from.
Each was fetched as `https://images.unsplash.com/photo-<id>?auto=format&fit=crop&w=<w>&q=60&fm=jpg`
at the width in its name.

The design's two randomuser.me avatars (Sam, Nan) are not used: those two are
drawn as initials.

| File | Unsplash photo id | Used for |
|---|---|---|
| `strip-00-paris-eiffel-tower-400.jpg` | `1502602898657-3e91760cbb34` | hero strip, top (desktop + phone) |
| `strip-01-venice-gondola-400.jpg` | `1523906834658-6e24ef2386f9` | hero strip, top (desktop + phone) |
| `strip-02-london-thames-aerial-400.jpg` | `1513635269975-59663e0ac1ad` | hero strip, top (desktop + phone) |
| `strip-03-mountains-above-cloud-400.jpg` | `1506905925346-21bda4d32df4` | hero strip, top (desktop + phone) |
| `strip-04-beach-sunrise-400.jpg` | `1507525428034-b723cf961d3e` | hero strip, top (desktop) |
| `strip-05-lake-rowing-boat-400.jpg` | `1476514525535-07fb3b4ae5f1` | hero strip, top (desktop) |
| `strip-06-turquoise-lake-boat-400.jpg` | `1501785888041-af3ef285b470` | hero strip, top (desktop) |
| `strip-07-desert-road-400.jpg` | `1500530855697-b586d89ba3ee` | hero strip, top (desktop) |
| `strip-08-green-valley-400.jpg` | `1469474968028-56623f02e42e` | hero strip, bottom (desktop + phone) |
| `strip-09-milky-way-mountains-400.jpg` | `1519681393784-d120267933ba` | hero strip, bottom (desktop + phone) |
| `strip-10-green-cliffs-400.jpg` | `1470071459604-3b5ec3a7fe05` | hero strip, bottom (desktop + phone) |
| `strip-11-forest-path-400.jpg` | `1441974231531-c6227db76b6e` | hero strip, bottom (desktop + phone) |
| `strip-12-mountain-lake-reflection-400.jpg` | `1493246507139-91e8fad9978e` | hero strip, bottom (desktop) |
| `strip-13-bridge-at-dusk-400.jpg` | `1499856871958-5b9627545d1a` | hero strip, bottom (desktop) |
| `strip-14-map-and-camera-400.jpg` | `1488646953014-85cb44e25828` | hero strip, bottom (desktop) |
| `strip-15-dinner-table-400.jpg` | `1414235077428-338989a2e8c0` | hero strip, bottom (desktop) |
| `thumb-forest-path-160.jpg` | `1441974231531-c6227db76b6e` | 01 · Kew Gardens |
| `thumb-dinner-table-160.jpg` | `1414235077428-338989a2e8c0` | 01 · The Glasshouse |
| `thumb-green-cliffs-160.jpg` | `1470071459604-3b5ec3a7fe05` | 01 · Richmond Park |
| `thumb-beach-sunrise-160.jpg` | `1507525428034-b723cf961d3e` | 01 · St Ives |
| `thumb-desert-road-160.jpg` | `1500530855697-b586d89ba3ee` | 01 · Eden Project |
| `thumb-bridge-at-dusk-160.jpg` | `1499856871958-5b9627545d1a` | 01 · Padstow |
| `avatar-maya-160.jpg` | `1503454537195-1dcabb73ffb9` | 02 · Maya, 7 |
| `thumb-durdle-door-160.jpg` | `1504096349903-8ef500040469` | 03 · Fossil hunting (Durdle Door) |
| `thumb-mountains-above-cloud-160.jpg` | `1506905925346-21bda4d32df4` | 03 · Stonehenge |
| `host-one-off-dinner-table-600.jpg` | `1414235077428-338989a2e8c0` | 04 · One-off card |
| `host-weekly-yoga-600.jpg` | `1544367567-0f2fcb009e0b` | 04 · Weekly card |
| `host-course-swimming-600.jpg` | `1574744918163-6cef6f4a31b0` | 04 · Course card |
| `host-on-request-kitchen-600.jpg` | `1556910103-1c02745aae4d` | 04 · On request card |

The image itself is `https://images.unsplash.com/photo-<id>` (Unsplash's own
photo pages use a different short slug, not this id).
