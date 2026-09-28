/**
 * Food & drink · Things to do (round 3, 29 Sep 2026): the toggle at the top of
 * Categories, Facts, Mapping and Collections. Pure, so it can be tested
 * without a screen; the control itself is `SideToggle` in kit.tsx.
 *
 * One query key, `side`, shared by the four tabs (a move between them keeps
 * it; Desk.tsx clears it on the way anywhere else), and a filter, so it
 * replaces. Things to do is every category that is not Food & drink.
 */

import type { FilingTab } from '../../routes';

export type Side = '' | 'food' | 'todo';
export const SIDE_KEY = 'side';
/** The Food & drink category's key (apps/api/src/desk/categories.js FOOD_CATEGORY). */
export const FOOD_CATEGORY = 'food';
export const SIDE_OPTIONS: { key: Side; name: string }[] = [
  { key: '', name: 'All' }, { key: 'food', name: 'Food & drink' }, { key: 'todo', name: 'Things to do' },
];
/** The tabs that draw the toggle and share its `side`. */
export const SIDE_TABS: readonly FilingTab[] = ['categories', 'facts', 'mapping', 'collections'];

export const asSide = (raw: string | null | undefined): Side => (raw === 'food' || raw === 'todo' ? raw : '');
/** The side a category is on. */
export const sideOfCategory = (cat: string | null | undefined): Side => (!cat ? '' : cat === FOOD_CATEGORY ? 'food' : 'todo');
/**
 * Whether something filed in these categories shows on a side. Something
 * that names none (a word nobody has placed, a collection over a fact alone)
 * narrows to neither, so it is on both.
 */
export const onSide = (side: Side, cats: (string | null | undefined)[]) => {
  const known = cats.filter(Boolean) as string[];
  return !side || !known.length || known.some((c) => sideOfCategory(c) === side);
};
/** The query a side is sent to the API as: nothing for All. */
export const sideParam = (side: Side) => (side ? { side } : {});
