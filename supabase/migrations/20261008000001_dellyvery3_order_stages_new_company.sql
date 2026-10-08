-- DELLVERY 3 — Kanban: seed de stages para empresas novas + backfill (FASE 1, local only)
--
-- Causa raiz achada no QA: o seed de 20261008000000 cobriu só as companies
-- existentes no momento do push. Empresas criadas DEPOIS (via
-- create_company_with_owner) ficavam com ZERO stages -> Kanban caía no
-- fallback e o fluxo por etapas degenerava. Correção:
--  1. trigger AFTER INSERT em companies semeia as 7 etapas padrão;
--  2. backfill das chaves legadas ausentes por company (idempotente).
-- Nenhum dado existente é alterado (ON CONFLICT DO NOTHING).

-- 1. Função de seed (mesmos valores do seed original)
create or replace function seed_default_order_stages(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.restaurant_order_stages
    (company_id, stage_key, maps_to, name, color, sort_order, is_initial, is_final, active)
  values
    (p_company_id, 'novo',                'novo',                'Novo',            '#3b82f6', 0, true,  false, true),
    (p_company_id, 'confirmado',          'confirmado',          'Confirmado',      '#eab308', 1, false, false, true),
    (p_company_id, 'em_preparo',          'em_preparo',          'Em preparo',      '#f97316', 2, false, false, true),
    (p_company_id, 'aguardando_retirada', 'aguardando_retirada', 'Pronto',          '#a855f7', 3, false, false, true),
    (p_company_id, 'saiu_entrega',        'saiu_entrega',        'Saiu p/ entrega', '#6366f1', 4, false, false, true),
    (p_company_id, 'finalizado',          'finalizado',          'Finalizado',      '#22c55e', 5, false, true,  true),
    (p_company_id, 'cancelado',           'cancelado',           'Cancelado',       '#ef4444', 6, false, false, true)
  on conflict (company_id, stage_key) do nothing;
end;
$$;

revoke all on function seed_default_order_stages(uuid) from public, anon;
grant execute on function seed_default_order_stages(uuid) to authenticated;

-- 2. Trigger: toda company nova já nasce com as 7 etapas
create or replace function trg_seed_order_stages_for_new_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_order_stages(new.id);
  return new;
end;
$$;

drop trigger if exists trg_companies_seed_order_stages on companies;
create trigger trg_companies_seed_order_stages
  after insert on companies
  for each row execute function trg_seed_order_stages_for_new_company();

-- 3. Backfill: chaves legadas ausentes em companies já existentes
-- (ex.: empresas criadas entre o push da FASE 1 e este fix).
do $$
declare
  v_company_id uuid;
begin
  for v_company_id in select id from public.companies loop
    perform public.seed_default_order_stages(v_company_id);
  end loop;
end;
$$;
