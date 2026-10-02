/** Which view draws which step. Step 1 ("what") and its modes are drawn by the shell (What.tsx). */
import type React from 'react';
import type { StepKey } from '../model';
import type { StepProps } from '../Setup';
import { OrderStep, RsvpStep, WhenStep } from './OneOff';
import { CohostsStep, PriceStep, WhereStep, WhoStep } from './Shared';
import { AvailStep, EveryWeekStep, OutcomeStep, RunStep, SessionsStep, StayDropStep, WeeklyPriceStep, WhyStep } from './Lanes';

export const STEP_VIEWS: Partial<Record<StepKey, React.ComponentType<StepProps>>> = {
  when: WhenStep, order: OrderStep, rsvp: RsvpStep,
  cohosts: CohostsStep, where: WhereStep, price: PriceStep, who: WhoStep,
  weekly: EveryWeekStep, wprice: WeeklyPriceStep,
  run: RunStep, outcome: OutcomeStep, sessions: SessionsStep, staydrop: StayDropStep,
  why: WhyStep, avail: AvailStep,
};
