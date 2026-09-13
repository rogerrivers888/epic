-- A fourth answer for a provider's word: "travel".
--
-- The owner, 13 Sep 2026: gas stations, chargers and rest stops are the
-- car's business, not Epic's ("we're here to plan your activities"); but
-- airports and stations are in scope ("we're going to let people plan out how
-- to get from the airport and how to get from the train station"), and so is
-- parking. "Anything related to the actual transportation being in a
-- category… travel, or it's literally getting from A to B: train, bus, ferry.
-- Parking."
--
-- So: 'travel' for getting there and parking; 'nearby' stays for what is
-- useful beside a day out without being one (a visitor centre, a loo);
-- 'aside' is "excluded from Epic". The rows Epic decided on its own before
-- this are moved to where they now belong.

alter table taxonomy_labels drop constraint if exists taxonomy_labels_decision_check;
alter table taxonomy_labels add constraint taxonomy_labels_decision_check
  check (decision is null or decision in ('aside', 'nearby', 'travel'));

update taxonomy_labels set decision = 'travel', active = true, updated_at = now()
 where namespace = 'google' and decision = 'nearby' and key in (
  'parking', 'parking_garage', 'parking_lot', 'park_and_ride',
  'train_station', 'bus_station', 'bus_stop', 'subway_station', 'light_rail_station', 'tram_stop', 'transit_station',
  'ferry_terminal', 'airport', 'international_airport');

update taxonomy_labels set decision = 'aside', active = false, updated_at = now()
 where namespace = 'google' and decision = 'nearby' and key in (
  'gas_station', 'electric_vehicle_charging_station', 'ebike_charging_station', 'rest_stop', 'bike_sharing_station');
