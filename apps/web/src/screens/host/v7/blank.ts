/**
 * A lane's set-up before anything is saved, and what each step needs before
 * Next is offered (the prototype's `ctaOk`: a category on step 1, a first
 * session on the run, a choice on Who can come).
 */
import { asksParentsOnWho, type HostLane, type LaneOffer, type StepKey } from './model';

export function blankOffer(lane: HostLane): LaneOffer {
  return {
    id: '', lane, state: 'draft', visibility: null, money: 'free', draftStep: null, draftSource: null, steps: [], missing: [],
    whatCategory: null, whatLabel: null, title: null, line: null, lineSuggested: false, photos: [],
    startsOn: null, startsAt: null, endsAt: null, multiDay: false, endsOn: null, runningOrder: [], cohosts: [],
    venue: null, venueLabel: null, venueArea: null, venueRef: null, venueNotes: null, travelRadiusMin: null, travelChargePence: null, onlineMode: null, onlineLink: null, timeZone: null,
    guestQuestions: {}, weekdays: [], firstDate: null, durationMin: null, sessions: null, excludeBankHolidays: true, skippedDates: [], run: null,
    outcome: null, topics: [], parents: null, whyYou: null, freeHours: {}, sessionLengths: [], noticeHours: 48, perWeekMax: 3,
    priceMode: null, pricePence: null, childPence: null, totalPence: null, per: 'person', minCount: null, maxCount: null,
    dropInPence: null, bookAheadPence: null, dropInGroupPct: null, dropInGroupMin: null, bookAheadGroupPct: null, bookAheadGroupMin: null,
    decidesOn: null, decidesOnDefault: null, refundPolicy: null, refundWords: null, ageMin: null, ageMax: null, asksParents: false, needsChecked: false,
    privatePlan: 'event', privateFeeState: 'unpaid',
    video: { id: null, url: null, madeBy: null, coverS: null, onProfile: true, photoIds: [], helloId: null, seconds: null, helloSeconds: null },
    invites: [], inviteUrl: '', pageUrl: '', sessionRows: [], checklist: [], blockers: [], action: { key: 'send', label: '' },
    charges: { kind: 'private', sharePct: 0, words: '' }, paid: false, throughEpic: false,
  };
}

export function canGoOn(o: LaneOffer, step: StepKey, adultAge = 18): boolean {
  if (step === 'what') return Boolean(o.whatLabel && o.title?.trim());
  if (step === 'run') return Boolean(o.firstDate);
  if (step === 'who') return Boolean(o.visibility) && (!asksParentsOnWho(o, adultAge) || Boolean(o.parents));
  return true;
}
