-- DELLVERY 3 — Seed business_segments (somente restaurant nesta fase)
-- Demais segmentos (pizzeria, cafe, market, store, pet_shop, services) preparados para expansao futura, nao seedados agora.

insert into business_segments (slug, name, description, icon, config, active)
values (
  'restaurant',
  'Restaurante',
  'Segmento inicial do DELLVERY 3. Produtos, categorias e pedidos genericos preparados para multissegmento.',
  'utensils',
  '{"prepared_for": ["pizzeria","cafe","market","store","pet_shop","services"]}'::jsonb,
  true
)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  config = excluded.config,
  active = excluded.active;
