-- A label that brings other labels with it.
--
-- The owner, 14 Sep 2026: "let us add labels that are always added when one
-- label is added. It comes with these other labels… Maybe they should be
-- coloured so I can see when I add splash pad, for example, and suddenly
-- outdoors appears."
--
-- Both sides are ours. A provider's word never appears here: it points at one
-- of our labels, and what that label brings is our business. Set on the
-- secondary label, because that is the one you add by hand.

alter table place_attributes add column if not exists comes_with text[] not null default '{}';
