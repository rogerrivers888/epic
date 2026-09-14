-- Shops and gyms come out.
--
-- The owner, 14 Sep 2026: "Shops and gyms should come out. They are not part of
-- planning a trip."
--
-- Most of the shop words were already excluded. These are the ones that were
-- not: a bookshop, a gift shop and a shopping centre had a drawer of their own,
-- and a toy shop, a department store, a sweet shop and a charity shop were
-- sitting unanswered. Gym, fitness centre and sports complex were the three
-- biggest unanswered words on the list at 62 places between them, and Epic's
-- own suggestion for all three was Pools, the swimming drawer, which was wrong.
--
-- Not touched, because he said shops rather than these:
--   * markets and flea markets — a market is a browse, not an errand;
--   * garden centres — ten of twelve were settled by their own cafés;
--   * anywhere you eat, whatever it calls itself: a sandwich shop, a bakery,
--     an ice cream shop and a kebab shop are all food.
update taxonomy_labels
   set decision = 'aside', points_at = null, updated_at = now()
 where namespace = 'google'
   and key in ('book_store', 'gift_shop', 'shopping_mall', 'candy_store', 'department_store',
               'thrift_store', 'toy_store', 'gym', 'fitness_center', 'sports_complex');

-- The rules that filled the bookshop drawer go with them, or the drawer keeps
-- filling from words nobody can see any more.
delete from shelf_rules
 where subcategory = 'browsing'
   and subject in ('google:book_store', 'google:gift_shop', 'google:shopping_mall',
                   'book_store', 'gift_shop', 'shopping_mall');

-- And the drawer itself. Switched off rather than deleted: a place already
-- filed there keeps its row, and switching it back on is one tap.
update shelf_subcategories set active = false, updated_at = now() where key = 'browsing';
