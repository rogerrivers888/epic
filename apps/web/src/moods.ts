/**
 * The moods, in words.
 *
 * The keys live in four places that move together (`domain/moods.js` on the
 * API, `MoodKey` in `api.ts`, `MOODS` in `routes.ts`, and here); the labels
 * are here once, for Inspire's strip and the lanes on a trip's Activities tab.
 */
import type { MoodKey } from './api';
import { MOODS } from './routes';
import type { LaneVocab } from './screens/tripLanes';

export const MOOD_LABEL: Record<string, string> = {
  fun: 'Fun', food: 'Food', culture: 'Culture',
  // Sport is the ticket and the membership; Active is what you turn up and do
  // (owner, 5 Sep 2026). The key is `activity` because the atlas already has a
  // category called `active` that means something else.
  sport: 'Sport', activity: 'Active',
  adrenaline: 'Adrenaline', relaxing: 'Relaxing', outdoors: 'Outdoors',
};

/** A spoken mood → the shelf it leads with (the same words the API's VIBE_TO_CATEGORY uses). */
export const VIBE_MOOD: Record<string, MoodKey> = { fun: 'fun', cultural: 'culture', active: 'activity', relaxed: 'relaxing' };

/** The three, together, for the lanes on a trip's Activities tab. */
export const LANE_VOCAB: LaneVocab = { order: MOODS, label: MOOD_LABEL, vibeMood: VIBE_MOOD };
