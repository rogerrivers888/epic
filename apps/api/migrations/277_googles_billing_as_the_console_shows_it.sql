-- Google's billing as the console showed it on 29 Sep 2026 (owner; account
-- 016AC3-155881-368408, epic.day), until the BigQuery export is read:
-- September usage £40.61, paid entirely by free-trial ("Promotional")
-- credit; £180.15 of £220.76 credit left, expiring 20 December 2026. The
-- daily billing job replaces the figures from the export and keeps the grant
-- and its expiry. Only where nobody has set it.
insert into bo_settings (key, value, updated_by)
values ('billing',
        '{"month": "2026-09", "usageGbp": 40.61, "paidGbp": 0, "creditGbp": 180.15, "creditTotalGbp": 220.76,
          "creditExpires": "2026-12-20", "source": "Google Cloud console, account 016AC3-155881-368408, 29 Sep 2026",
          "at": "2026-09-29T12:00:00Z"}'::jsonb,
        'Epic (migration 277)')
on conflict (key) do nothing;
