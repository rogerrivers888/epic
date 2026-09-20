-- The reason a place has no cell was recorded back to front.
--
-- `place_cells.why` exists for one purpose: telling a batch that failed from a
-- place that genuinely cannot be placed. It could not do it. `outcodesFor`
-- marks a request that never arrived as `{ failed: true }` — which the stamping
-- pass skips, leaving no row at all — and leaves the slot **null** when the
-- request did arrive and ONS simply had no postcode within its two kilometres.
-- The stamping pass wrote that null down as "no answer for this point", which
-- reads as an outage and is the opposite of what happened.
--
-- So every one of the 638 unplaceable places carried a reason that said the
-- ask had failed, when in fact the ask succeeded and there is nothing there:
-- at sea, outside the United Kingdom, or further from a postcode than ONS will
-- look. The behaviour was right all along — a null cell cannot join `reach`, so
-- these places never appear in any catchment, which is the fail-closed answer
-- (owner, 20 Sep 2026: "the fail-closed behaviour is right; the reason string
-- being wrong on all 638 defeats the only purpose the field has").
--
-- Only the rows written by that branch are touched, and only the wording: no
-- place gains or loses a cell here.

update place_cells
   set why = 'ONS answered; no postcode within 2km'
 where cell is null
   and why = 'no answer for this point';
