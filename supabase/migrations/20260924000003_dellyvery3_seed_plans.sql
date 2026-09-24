-- DELLVERY 3 — Seed plans (somente Solo nesta fase)
-- Compativel com Company.jsonc plan_status trial e Subscription status trial
-- Nao criar equipe/multi_unidade agora.

insert into plans (slug, name, price, billing_cycle, features, limits, active, sort_order)
values (
  'solo',
  'Solo',
  0,
  'monthly',
  '[]'::jsonb,
  '{"users": 1, "products": -1, "orders": -1, "customers": -1, "storage_mb": 100}'::jsonb,
  true,
  0
)
on conflict (slug) do update set
  name = excluded.name,
  price = excluded.price,
  billing_cycle = excluded.billing_cycle,
  features = excluded.features,
  limits = excluded.limits,
  active = excluded.active,
  sort_order = excluded.sort_order;
