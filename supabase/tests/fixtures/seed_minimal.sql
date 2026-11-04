-- Dados minimos para executar a suite SQL em um schema restaurado sem dados.
insert into public.plans (
  name, slug, price, billing_cycle, features, limits, active, sort_order, access_days
)
values (
  'Solo', 'solo', 0, 'monthly', '[]'::jsonb, '{}'::jsonb, true, 0, 30
)
on conflict (slug) do update
set active = true,
    access_days = 30;

insert into public.business_segments (slug, name)
values ('restaurant', 'Restaurante')
on conflict (slug) do nothing;
