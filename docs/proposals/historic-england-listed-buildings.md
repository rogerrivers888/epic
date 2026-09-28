# Proposal: listed buildings from the national heritage lists (29 Sep 2026)

**For:** the Church decision on Mapping (Roger pressed Keep, 29 Sep 2026: "Propose loading Historic England's listed-building data (open licence) for the narrowing later").

## The problem it solves
`google:church` catches every parish church, chapel and meeting hall. Families want the handful worth a visit: a Norman nave, a cathedral, a wool church. Google can't tell them apart, and a graded "how historic" score is off the table (B1, the axes were dropped). A listing grade is a fact written down by someone else, not a judgement we make, so it fits the rule "if it can't be extracted, it can't exist".

## What to load
| List | Covers | Licence (confirm before loading) | Size |
|---|---|---|---|
| National Heritage List for England (Historic England, Open Data Hub) | listed buildings with grade I / II* / II, scheduled monuments, parks and gardens, battlefields | Open Government Licence v3.0, with the Ordnance Survey attribution Historic England asks for | ~400k list entries |
| Historic Environment Scotland designations | listed buildings (A/B/C), scheduled monuments | OGL | ~47k |
| Cadw (Wales) | listed buildings, scheduled monuments | OGL | ~30k |
| NI Historic Environment Division | listed buildings (A/B+/B1/B2) | OGL (check) | ~9k |

We keep: the list entry number, name, grade, point and list date. That's owned data (open licence, attributed), and it goes in its own table next to the OSM extract. Nothing rented is involved.

## How it narrows Church
1. Match each church in Epic to a listing: within 50 m, with the name agreeing (the same fence-and-fail-closed rule as the OSM match). OSM often carries `heritage=2` and `listed_status`, plus a `HE_ref` tag, which gives a free first match for many.
2. Two new yes/no facts, answered from the list, never from Google: **Grade I listed** and **Grade II\* listed** (and the Scottish, Welsh and NI equivalents under the same labels).
3. The Church drawer then files "Historic churches" as Church ∧ (Grade I ∨ Grade II\*): a few thousand churches in England instead of every chapel. That figure is from memory, not measured; the loader reports the real count before anything is filed. The rest stay in Places of worship and are never shown as things to do.
4. The same facts serve castles, country houses and ruins, which is why this is worth more than the church fix alone.

## Cost and risk
- £0 from providers. One download a quarter, run by the existing daily-job pattern; a few MB zipped (the full CSV/GeoJSON is ~150 MB).
- Attribution line on the drawer and the Sources catalogue.
- Risk: name mismatches ("St Mary the Virgin" vs "Church of St Mary"). Fail closed: no match means no fact, never a guess.

## Needs from you
Say yes to the loader (a new source is earned; this one is a check that narrows Google's own category, not a second source of discovery). Nothing here spends money or holds a secret.
