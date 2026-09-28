/**
 * The info icon beside a page heading, and where it goes.
 *
 * One component for every screen in the filing workflow (owner's brief, 26 Sep
 * 2026: "One shared component, not five"). It sits beside the heading as a
 * heading affordance — quiet, not a banner — and tapping it opens How it works
 * › Business mechanics at the section that explains the screen it was on,
 * rather than the top of the page.
 *
 * The address is spelled in `routes.ts` and nothing here reads or writes the
 * address bar itself: the icon asks the router to move, and How it works reads
 * `?at=` back out of the query and scrolls to that section.
 */

import React from 'react';
import { View } from 'react-native';
import { Icon } from '../components/Icon';
import { Press } from '../components/press';
import { useRouter } from '../router';
import { paths, type HowAnchor } from '../routes';
import { desk } from '../theme';

/** What each section is called, so the icon can say where it goes. */
const SAYS: Record<HowAnchor, string> = {
  layers: 'The three layers',
  categories: 'Nine categories — and no scores',
  mapping: 'Google’s words, and where they go',
  place: 'What a place actually carries',
  facts: 'Two kinds of check',
  where: 'Where a value comes from',
  pipeline: 'How a fact gets born',
  collections: 'Collections — what a family browses',
  journey: 'What happens when a family searches',
  counting: 'Counting honestly',
  state: 'Where this actually stands',
};

export function HowIcon({ at, size = 15 }: { at: HowAnchor; size?: number }) {
  const { navigate } = useRouter();
  return (
    <Press
      effect="none"
      onPress={() => navigate(paths.how(at))}
      accessibilityRole="link"
      accessibilityLabel={`${SAYS[at]} — opens How it works`}
      // The web reads `title` as the hover tooltip; native ignores it.
      {...({ title: SAYS[at] } as object)}
      hitSlop={8}
    >
      <View style={{ paddingTop: 2 }}>
        <Icon name="info" size={size} color={desk.inkDim} strokeWidth={2} />
      </View>
    </Press>
  );
}
