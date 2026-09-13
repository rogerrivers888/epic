-- A bus stop decided before Travel existed was excluded with the rest of
-- Transportation; it belongs with the stations (Codex, 13 Sep 2026).
update taxonomy_labels set decision = 'travel', active = true, updated_at = now()
 where namespace = 'google' and key = 'bus_stop' and decision = 'aside';
