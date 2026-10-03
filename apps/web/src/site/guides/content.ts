/**
 * The guides' words, typed. Apart from index.ts because a JSON import is for the
 * bundler: the tests read guides.json from disk instead.
 */
import GUIDES_JSON from './guides.json';
import type { Guide, GuideSlug } from './index';

export const GUIDES = GUIDES_JSON as unknown as Record<GuideSlug, Guide>;
