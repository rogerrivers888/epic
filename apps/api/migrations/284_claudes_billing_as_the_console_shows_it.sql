-- Claude's billing as Anthropic's console showed it on 29 Sep 2026 (owner,
-- Epic organisation): September to date $117.02 (about £87), $382.99 of
-- prepaid credit remaining. The ledger's own figure was £121, list price at
-- whichever rate each caller assumed; the Overview tile reads this instead,
-- in dollars with pounds beside, until Anthropic's usage is read directly.
-- Only where nobody has set it.
insert into bo_settings (key, value, updated_by)
values ('claudeBilling',
        '{"month": "2026-09", "usd": 117.02, "gbp": 87, "creditUsd": 382.99,
          "source": "Anthropic console, Epic organisation, 29 Sep 2026", "at": "2026-09-29T12:00:00Z"}'::jsonb,
        'Epic (migration 284)')
on conflict (key) do nothing;
