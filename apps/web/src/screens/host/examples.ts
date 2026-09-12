/**
 * What people host: the worked examples the learn layer shows (Host Journey
 * canvas, L2 · L3; the prototype's SHAPES). Real words, the actual video
 * script, the actual price — "nobody reads 'Practitioner: you sell a skill or
 * a craft' and thinks that's me. They read 'Jay is at the skatepark on
 * Saturdays anyway, £12' and think it."
 *
 * Static on purpose: these are Epic's own examples, not listings, and they
 * must be there for somebody in a town where nobody hosts yet.
 */

import type { HostType, LocalKind, OfferShape, Visibility } from '../../api';

export type ShapeStory = { tag: string; title: string; eg: string; link: string; sTitle: string; sBlurb: string; note: string; egs: { title: string; meta: string; vis: 'PRIVATE' | 'PUBLIC' }[] };

export const SHAPE_STORIES: Record<OfferShape, ShapeStory> = {
  oneoff: {
    tag: 'ONE-OFF', title: 'A thing that happens once', eg: 'A supper club, a skate jam, a whole day you have planned.', link: 'See how a one-off works ›',
    sTitle: 'One date, one start time', sBlurb: 'You list the running order, and who else will be there.',
    note: 'A wedding is a one-off too — the only difference is that you set it to invite-only.',
    egs: [
      { title: 'Our wedding at the barn', meta: 'Sat 14 Jun · invite-only · 86 RSVPs', vis: 'PRIVATE' },
      { title: 'Dad’s seventieth, at the golf club', meta: 'Sat 4 Oct · invite-only · 40 coming', vis: 'PRIVATE' },
      { title: 'A supper from the garden, and a talk on foraging', meta: 'Fri 26 Sep · 2 h 30 · £42 each', vis: 'PUBLIC' },
      { title: 'Saturday skate jam, for people starting out', meta: 'Sat 20 Sep · 3 h · £12 each', vis: 'PUBLIC' },
    ],
  },
  series: {
    tag: 'SERIES', title: 'The same thing, every week', eg: 'Ten Tuesdays learning to draw. A run club.', link: 'See how a series works ›',
    sTitle: 'A fixed run of sessions', sBlurb: 'You say what they can do by the end, then the weeks.',
    note: 'You choose whether people take the whole run or drop into a single session.',
    egs: [
      { title: 'Homeschool science, Wednesday mornings', meta: 'Eight weeks · invite-only · our six', vis: 'PRIVATE' },
      { title: 'Book group, first Monday', meta: 'Monthly · invite-only · 9 of us', vis: 'PRIVATE' },
      { title: 'Tuesday run club round the lake', meta: 'Ten Tuesdays · £40 the series', vis: 'PUBLIC' },
      { title: 'Six Thursdays, learning to see', meta: 'From 25 Sep · 6 weeks · £150', vis: 'PUBLIC' },
    ],
  },
  anytime: {
    tag: 'ANYTIME', title: 'People book your time', eg: 'An hour of advice. A day out with the kids.', link: 'See how anytime works ›',
    sTitle: 'No date — they pick a slot', sBlurb: 'You say what you offer, and the days you are free.',
    note: 'This is the one hosts add most of: the least to set up, and it never goes out of date.',
    egs: [
      { title: 'A day round here with our two, and yours', meta: '5 h · out and about · free', vis: 'PRIVATE' },
      { title: 'Coffee and a walk, whenever you are over', meta: '2 h · invite-only · for friends visiting', vis: 'PRIVATE' },
      { title: 'An hour on getting the best out of AI', meta: '1 h · online · £80', vis: 'PUBLIC' },
      { title: 'A sourdough morning in my kitchen', meta: '3 h · their place · £45', vis: 'PUBLIC' },
    ],
  },
};

export type WorkedExample = {
  key: string; passion: string; who: string;
  kind: HostType; sub?: LocalKind; shape: OfferShape; visibility: Visibility;
  title: string; line: string; seconds: number; said: string;
  why: { t: string; s: string }[];
};

export const EXAMPLES: WorkedExample[] = [
  {
    key: 'skateboarding', passion: 'Skateboarding', who: 'Been skating 20 years · teaches on Saturdays',
    kind: 'meetups', sub: 'already_do', shape: 'series', visibility: 'public',
    title: 'Saturday morning at the skatepark, for people starting out', line: 'Jay, 34 · Reading · £12 a session, or £50 for six', seconds: 48,
    said: 'I’m Jay, I’ve been skating since I was fourteen and I’m still not very good, which is the point. Saturdays I’m at Reading skatepark anyway. Come and I’ll get you rolling, turning and falling over properly by the end of it.',
    why: [
      { t: 'He is honest about his level', s: '“Still not very good” is why a beginner books him' },
      { t: 'He was going anyway', s: 'No extra effort, so the price can be low' },
      { t: 'You know what you will leave with', s: 'Rolling, turning, falling over properly' },
    ],
  },
  {
    key: 'cooking', passion: 'Cooking what you cook', who: 'Nothing fancy · her actual Tuesday dinner',
    kind: 'skill', shape: 'oneoff', visibility: 'public',
    title: 'Tuesday dinner, the way I actually make it', line: 'Nadia, 41 · Windsor · £18 each, six round the table', seconds: 52,
    said: 'I’m Nadia and I cook the same three things every week because they work. Tuesday is the lentils. Come at seven, we chop, we eat, you leave with the recipe on a card and probably a jar of the chilli oil.',
    why: [
      { t: 'It is her real Tuesday', s: 'Nothing is staged, so it is easy to run again' },
      { t: 'Six is the table', s: 'The maximum is the number of chairs, not a guess' },
      { t: 'You leave with something', s: 'The card and the jar are the reason people book twice' },
    ],
  },
  {
    key: 'homeschool', passion: 'Homeschool science', who: 'Runs it for her three, now for six',
    kind: 'skill', shape: 'series', visibility: 'link',
    title: 'Wednesday mornings: proper experiments, eight weeks', line: 'Priya, 39 · Caversham · £8 a week, the link goes round the group', seconds: 44,
    said: 'I do science with my three on Wednesday mornings and there is room for three more at the table. Eight weeks, one experiment each week, real equipment. They will have made a battery, grown crystals and blown something up safely.',
    why: [
      { t: 'It was happening anyway', s: 'Three more at a table already laid' },
      { t: 'The link, not the public', s: 'Passed round the homeschool group — no video, no checks' },
      { t: 'By the end they can', s: 'A battery, crystals, a safe explosion — the outcome is the pitch' },
    ],
  },
  {
    key: 'family-day', passion: 'A day with the kids', who: 'Two kids, knows every playground',
    kind: 'meetups', sub: 'family', shape: 'anytime', visibility: 'public',
    title: 'A day round here with our two, and yours', line: 'Dev and Priya · Virginia Water · free, both families together', seconds: 39,
    said: 'We’ve got a nine-year-old and a four-year-old and we have tested every playground and café within half an hour. Tell us your kids’ ages and we will just take you along to a Saturday.',
    why: [
      { t: 'Both families, daytime, in public', s: 'That is the whole safety story, and the whole product' },
      { t: 'Ages, not names', s: 'A child is an age band and what they are into — never a photograph' },
      { t: 'Free', s: 'Nobody charges for time with children. Anyone who does is not doing this' },
    ],
  },
  {
    key: 'history-walk', passion: 'Reading, as it actually was', who: 'Taught it for twenty years',
    kind: 'expert', shape: 'anytime', visibility: 'public',
    title: 'Ninety minutes round the old town with a historian', line: 'Alan, 58 · Reading · £15 each, book a slot', seconds: 57,
    said: 'I’m Alan, I taught history here for twenty years. We start at the abbey ruins and finish where the Kennet meets the Thames — what was here before the shops, who built it and who pulled it down. Flat walking, nothing strenuous.',
    why: [
      { t: 'Expert by depth, not by job', s: 'He is retired; what he knows is real, and that is what we ask him to show' },
      { t: 'Nothing strenuous, said up front', s: 'Who it suits is half the listing' },
      { t: 'No licence needed here', s: 'Reading does not require one; Florence would' },
    ],
  },
];

export const MORE_PASSIONS = ['Sea swimming', 'Foraging', 'Climbing', 'Records', 'Yoga', 'Photography', 'Gardening', 'Running'];
