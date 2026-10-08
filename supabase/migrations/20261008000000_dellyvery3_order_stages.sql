-- DELLVERY 3 — Kanban configurável por empresa (FASE 1, local only)
--
-- Estratégia de compatibilidade com o legado (decisão Fase 1):
--  - `orders.status` (enum order_status) CONTINUA sendo a fonte da verdade.
--    create_order / manage_order / get_order_by_token / notifications
--    (UNIQUE order_id+status) / finance (PAID_STATUS=finalizado) / orderQueue
--    NÃO são alterados por esta migration.
--  - `restaurant_order_stages` é a camada de APRESENTAÇÃO/ORDENAÇÃO por
--    company: cada stage tem `stage_key` (legado ou slug custom) e `maps_to`
--    (status legado efetivo gravado em orders.status). Avançar/voltar navega
--    pelas stages visíveis e traduz para UMA transição de status legado.
--  - Stages customizadas OBRIGATORIAMENTE mapeiam para um status legado
--    (maps_to); stages com chave legada têm maps_to travado (= a própria
--    chave) via trigger, então pedidos antigos nunca ficam órfãos.
--  - Banco usa `sort_order` (padrão do projeto, ex. categories/products);
--    o adapter expõe como `position` (mesmo padrão de catalog.js).
--  - Sem SELECT anon: leitura pública continua via RPCs existentes.

-- =========================
-- 1. Tabela
-- =========================
create table if not exists restaurant_order_stages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  stage_key text not null,
  maps_to order_status not null,
  name text not null,
  color text not null default '#6366f1',
  sort_order int not null default 0,
  is_initial boolean not null default false,
  is_final boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_stage_company_key unique (company_id, stage_key),
  constraint chk_stage_name_not_empty check (btrim(name) <> ''),
  constraint chk_stage_color_hex check (color ~ '^#[0-9a-fA-F]{6}$')
);

create index if not exists idx_order_stages_company_pos
  on restaurant_order_stages (company_id, sort_order);
create index if not exists idx_order_stages_company_maps
  on restaurant_order_stages (company_id, maps_to);

-- =========================
-- 2. Triggers
-- =========================
-- updated_at (helper existente)
drop trigger if exists trg_order_stages_updated_at on restaurant_order_stages;
create trigger trg_order_stages_updated_at
  before update on restaurant_order_stages
  for each row execute function set_updated_at();

-- company_id imutável (padrão do projeto)
drop trigger if exists trg_immutable_company on restaurant_order_stages;
create trigger trg_immutable_company
  before update on restaurant_order_stages
  for each row execute function prevent_company_id_change();

-- stage_key imutável (referência estável do frontend; renomear = coluna name)
create or replace function prevent_stage_key_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.stage_key is distinct from new.stage_key then
    raise exception 'stage_key is immutable (renomeie via name)';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_order_stages_key_immutable on restaurant_order_stages;
create trigger trg_order_stages_key_immutable
  before update on restaurant_order_stages
  for each row execute function prevent_stage_key_change();

-- Mapeamento legado travado: stage com chave legada sempre reflete o
-- próprio status (impede que 'novo' passe a mapear para 'finalizado', etc.)
create or replace function enforce_legacy_stage_mapping()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.stage_key in ('novo','confirmado','em_preparo','aguardando_retirada','saiu_entrega','finalizado','cancelado') then
    new.maps_to := new.stage_key::public.order_status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_order_stages_legacy_map on restaurant_order_stages;
create trigger trg_order_stages_legacy_map
  before insert or update on restaurant_order_stages
  for each row execute function enforce_legacy_stage_mapping();

-- Uma única stage inicial e uma única final por empresa (radio behavior)
create or replace function maintain_single_initial_final_stage()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.is_initial, false) then
    update public.restaurant_order_stages
      set is_initial = false
      where company_id = new.company_id and id <> new.id and is_initial = true;
  end if;
  if coalesce(new.is_final, false) then
    update public.restaurant_order_stages
      set is_final = false
      where company_id = new.company_id and id <> new.id and is_final = true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_order_stages_single_flags on restaurant_order_stages;
create trigger trg_order_stages_single_flags
  after insert or update on restaurant_order_stages
  for each row execute function maintain_single_initial_final_stage();

-- =========================
-- 3. Seed: 7 etapas atuais para TODAS as companies existentes
-- (idempotente; preserva comportamento atual do Kanban)
-- =========================
insert into restaurant_order_stages
  (company_id, stage_key, maps_to, name, color, sort_order, is_initial, is_final, active)
select
  c.id, d.stage_key, d.maps_to::public.order_status, d.name, d.color,
  d.sort_order, d.is_initial, d.is_final, true
from public.companies c
cross join (values
  ('novo',                'novo',                'Novo',            '#3b82f6',  0, true,  false),
  ('confirmado',          'confirmado',          'Confirmado',      '#eab308',  1, false, false),
  ('em_preparo',          'em_preparo',          'Em preparo',      '#f97316',  2, false, false),
  ('aguardando_retirada', 'aguardando_retirada', 'Pronto',          '#a855f7',  3, false, false),
  ('saiu_entrega',        'saiu_entrega',        'Saiu p/ entrega', '#6366f1',  4, false, false),
  ('finalizado',          'finalizado',          'Finalizado',      '#22c55e',  5, false, true),
  ('cancelado',           'cancelado',           'Cancelado',       '#ef4444',  6, false, false)
) as d(stage_key, maps_to, name, color, sort_order, is_initial, is_final)
on conflict (company_id, stage_key) do nothing;

-- =========================
-- 4. RLS (padrão do projeto: ponte company_members)
-- Leitura: qualquer membro ativo. Escrita: OWNER/ADMIN/MANAGER
-- (mesmo nível do catálogo: categories/products).
-- =========================
alter table restaurant_order_stages enable row level security;

drop policy if exists order_stages_select_member on restaurant_order_stages;
create policy order_stages_select_member on restaurant_order_stages
  for select to authenticated
  using (is_company_member(company_id) or is_platform_admin());

drop policy if exists order_stages_insert_mgr on restaurant_order_stages;
create policy order_stages_insert_mgr on restaurant_order_stages
  for insert to authenticated
  with check (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER'))
    or is_platform_admin()
  );

drop policy if exists order_stages_update_mgr on restaurant_order_stages;
create policy order_stages_update_mgr on restaurant_order_stages
  for update to authenticated
  using (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER'))
    or is_platform_admin()
  )
  with check (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER'))
    or is_platform_admin()
  );

drop policy if exists order_stages_delete_mgr on restaurant_order_stages;
create policy order_stages_delete_mgr on restaurant_order_stages
  for delete to authenticated
  using (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER'))
    or is_platform_admin()
  );

-- =========================
-- 5. Realtime: Kanban atualiza colunas ao editar stages
-- =========================
alter publication supabase_realtime add table restaurant_order_stages;
alter table restaurant_order_stages replica identity full;
