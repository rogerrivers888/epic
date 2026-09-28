-- The visit question (Families confirm, "Epic Visit Question" board V1–V4,
-- owner 28 Sep 2026).
--
-- 1. Every yes/no fact carries the question a family is asked about it, with
--    {place} where the place's short name goes. A fact with no question is
--    asked in the default form, "Was there a {fact} at {place}?". Range facts
--    (ages, duration, cost) are never asked, so they get none.
alter table place_attributes add column if not exists question text;

update place_attributes set question = q.question
  from (values
    ('dog-friendly',     'Were dogs welcome at {place}?'),
    ('step-free',        'Could you get in without steps at {place}?'),
    ('indoor',           'Was {place} indoors?'),
    ('parking',          'Was there parking at {place}?'),
    ('toilets',          'Were there toilets at {place}?'),
    ('food-on-site',     'Could you get food at {place}?'),
    ('booking-required', 'Did you have to book ahead for {place}?')
  ) as q(key, question)
 where place_attributes.key = q.key and place_attributes.kind = 'yesno' and place_attributes.question is null;

-- The access facts that exist under other keys, found by what they are called.
update place_attributes set question = 'Was there an accessible toilet at {place}?'
 where kind = 'yesno' and question is null and lower(label) in ('accessible toilet', 'accessible toilets', 'disabled toilet', 'disabled toilets');
update place_attributes set question = 'Was there a hearing loop at {place}?'
 where kind = 'yesno' and question is null and lower(label) in ('hearing loop', 'induction loop');
update place_attributes set question = 'Could you get round {place} in a wheelchair?'
 where kind = 'yesno' and question is null and lower(label) in ('wheelchair accessible', 'wheelchair access', 'wheelchair friendly');
update place_attributes set question = 'Was there a Changing Places toilet at {place}?'
 where kind = 'yesno' and question is null and lower(label) in ('changing places', 'changing places toilet');

-- 2. Which facts are about access needs — asked only of a household that has
--    said access matters to it. This is not `access` (migration 266): that
--    flag groups the visiting facts re-checked on recheckAccess and exempt
--    from shareMax, and it is on for parking, toilets, dogs and booking too,
--    which every household may be asked about.
alter table place_attributes add column if not exists access_need boolean not null default false;
update place_attributes set access_need = true
 where not access_need and kind = 'yesno'
   and (key = 'step-free'
        or lower(label) in ('accessible toilet', 'accessible toilets', 'disabled toilet', 'disabled toilets',
                            'hearing loop', 'induction loop', 'wheelchair accessible', 'wheelchair access',
                            'wheelchair friendly', 'changing places', 'changing places toilet'));

-- 3. "Access needs in our household" — off until the household says so.
alter table households add column if not exists access_needs boolean not null default false;

-- 4. "Didn't notice" is stored as unsure: the fact is not asked again, and the
--    answer is never counted anywhere.
alter table family_answers drop constraint if exists family_answers_answer_check;
update family_answers set answer = 'unsure' where answer = 'didnt_notice';
alter table family_answers add constraint family_answers_answer_check check (answer in ('yes', 'no', 'unsure'));

-- 5. The place a hosted experience happens at, when it happens at one — the
--    rating after it asks its question about that place. Null for anything
--    online, at home or not at a place we know, and then nothing is asked.
alter table host_offers add column if not exists venue_ref text;
