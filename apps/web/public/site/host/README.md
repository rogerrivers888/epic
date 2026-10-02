# The photos on the host page's "Four ways to host" cards

Four photos from **Unsplash**, as the "Webstie & host v3" handoff (2 Oct 2026) names
them, downloaded and served by us rather than hot-linked, so the page costs no
third-party request. Each was fetched at 700px wide, JPEG, quality 60
(`https://images.unsplash.com/photo-<id>?auto=format&fit=crop&w=700&q=60&fm=jpg`).

| File | Card | What it shows | Unsplash photo |
|---|---|---|---|
| `host-one-off-durdle-door-700.jpg` | One-off · Fossil hunting with a geologist | Durdle Door, Jurassic Coast | `photo-1504096349903-8ef500040469` |
| `host-weekly-pottery-wheel-700.jpg` | Weekly · Weekly pottery workshop | Hands throwing clay on a wheel | `photo-1493106641515-6b5631de4bb9` |
| `host-course-swimming-goggles-700.jpg` | Course · Learn to swim, ages 5–8 | Young girl in goggles, swimming | `photo-1574744918163-6cef6f4a31b0` |
| `host-on-request-cooking-kitchen-700.jpg` | On request · A Thai cooking lesson at yours | Cooking together in a kitchen | `photo-1556910103-1c02745aae4d` |

**These are placeholders.** They are used under the Unsplash Licence (free use,
commercial included, no attribution required, not to be resold as stock), and the
handoff says to swap in licensed or own photography before launch.

Replacing one is a matter of dropping a file in and editing `PHOTO` in
`apps/web/src/site/pages/HostKindCards.tsx`.
