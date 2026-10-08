-- DELLVERY 3 — Configurador de produtos: estrutura (FASE 4A, local only)
--
-- Escopo ESTRITO 4A (sem UI, sem validate_config, sem v2, sem 3C):
--  1. ingredients (catálogo reutilizável por empresa)
--  2. product_config_steps (etapas ordenadas com min/max/free/required/repeat)
--  3. product_config_options (origem EXATAMENTE uma: ingredient XOR product)
-- Regra de preço (contrato): options.price = SEMPRE o adicional. Produto
-- referenciado NÃO tem seu preço somado automaticamente (escolha incluída;
-- upgrade vai explícito em price). Histórico será snapshotado em v2 (4B).
-- Legado products.options: intacto, sem conversão (futura, por empresa/flag).
-- Realtime: NÃO alterado nesta fase (sem necessidade de live no Gestão).

-- Enum do modo de seleção (padrão do projeto: tipos PG para conjuntos fixos)
do $$ begin
  create type config_select_mode as enum ('single', 'multi');
exception when duplicate_object then null; end $$;

-- =========================
-- 1. ingredients
-- =========================
create table if not exists ingredients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint chk_ingredient_name_not_empty check (btrim(name) <> '')
);

create index if not exists idx_ingredients_company_sort
  on ingredients (company_id, sort_order);
create index if not exists idx_ingredients_company_active
  on ingredients (company_id, active);

drop trigger if exists trg_immutable_company on ingredients;
create trigger trg_immutable_company
  before update on ingredients
  for each row execute function prevent_company_id_change();

alter table ingredients enable row level security;

drop policy if exists ingredients_select_member on ingredients;
create policy ingredients_select_member on ingredients
  for select to authenticated
  using (is_company_member(company_id) or is_platform_admin());

drop policy if exists ingredients_insert_mgr on ingredients;
create policy ingredients_insert_mgr on ingredients
  for insert to authenticated
  with check (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER'))
    or is_platform_admin()
  );

drop policy if exists ingredients_update_mgr on ingredients;
create policy ingredients_update_mgr on ingredients
  for update to authenticated
  using (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER'))
    or is_platform_admin()
  )
  with check (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER'))
    or is_platform_admin()
  );

drop policy if exists ingredients_delete_mgr on ingredients;
create policy ingredients_delete_mgr on ingredients
  for delete to authenticated
  using (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER'))
    or is_platform_admin()
  );

-- =========================
-- 2. product_config_steps
-- =========================
create table if not exists product_config_steps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  position int not null default 0,
  title text not null,
  description text,
  select_mode config_select_mode not null default 'multi',
  min_select int not null default 0,
  max_select int not null default 1,
  free_qty int not null default 0,
  required boolean not null default false,
  allow_repeat boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_step_title_not_empty check (btrim(title) <> ''),
  constraint chk_step_position_nonneg check (position >= 0),
  constraint chk_step_min_nonneg check (min_select >= 0),
  constraint chk_step_max_min check (max_select >= 1),
  constraint chk_step_min_le_max check (min_select <= max_select),
  constraint chk_step_free_nonneg check (free_qty >= 0),
  constraint chk_step_free_le_max check (free_qty <= max_select),
  constraint chk_step_max_limit check (max_select <= 20),
  constraint uq_step_product_position unique (product_id, position)
);

create index if not exists idx_config_steps_company
  on product_config_steps (company_id);
create index if not exists idx_config_steps_product_sort
  on product_config_steps (product_id, position);
create index if not exists idx_config_steps_product_active
  on product_config_steps (product_id, active);

drop trigger if exists trg_config_steps_updated_at on product_config_steps;
create trigger trg_config_steps_updated_at
  before update on product_config_steps
  for each row execute function set_updated_at();

drop trigger if exists trg_immutable_company on product_config_steps;
create trigger trg_immutable_company
  before update on product_config_steps
  for each row execute function prevent_company_id_change();

alter table product_config_steps enable row level security;

drop policy if exists config_steps_select_member on product_config_steps;
create policy config_steps_select_member on product_config_steps
  for select to authenticated
  using (is_company_member(company_id) or is_platform_admin());

drop policy if exists config_steps_insert_mgr on product_config_steps;
create policy config_steps_insert_mgr on product_config_steps
  for insert to authenticated
  with check (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER'))
    or is_platform_admin()
  );

drop policy if exists config_steps_update_mgr on product_config_steps;
create policy config_steps_update_mgr on product_config_steps
  for update to authenticated
  using (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER'))
    or is_platform_admin()
  )
  with check (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER'))
    or is_platform_admin()
  );

drop policy if exists config_steps_delete_mgr on product_config_steps;
create policy config_steps_delete_mgr on product_config_steps
  for delete to authenticated
  using (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER'))
    or is_platform_admin()
  );

-- =========================
-- 3. product_config_options (origem: ingredient XOR product, nunca ambos/none)
-- =========================
create table if not exists product_config_options (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references product_config_steps(id) on delete cascade,
  -- RESTRICT (não SET NULL): anular a origem violaria chk_option_single_origin.
  -- Origem referenciada se desativa (active=false), não se apaga.
  ingredient_id uuid references ingredients(id) on delete restrict,
  product_id uuid references products(id) on delete restrict,
  name text not null,
  price numeric(10,2) not null default 0,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint chk_option_name_not_empty check (btrim(name) <> ''),
  constraint chk_option_price_nonneg check (price >= 0),
  constraint chk_option_sort_nonneg check (sort_order >= 0),
  constraint chk_option_single_origin check (num_nonnulls(ingredient_id, product_id) = 1)
);

create index if not exists idx_config_options_step_sort
  on product_config_options (step_id, sort_order);
create index if not exists idx_config_options_step_active
  on product_config_options (step_id, active);

alter table product_config_options enable row level security;

-- tenant via step (padrão indireto, como order_items via orders)
create or replace function enforce_config_option_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_ref uuid;
begin
  select company_id into v_company from public.product_config_steps where id = new.step_id;
  if v_company is null then
    raise exception 'config step not found';
  end if;
  if new.ingredient_id is not null then
    select company_id into v_ref from public.ingredients where id = new.ingredient_id;
    if v_ref is null then
      raise exception 'ingredient not found';
    end if;
    if v_ref is distinct from v_company then
      raise exception 'ingredient belongs to another company';
    end if;
  end if;
  if new.product_id is not null then
    select company_id into v_ref from public.products where id = new.product_id;
    if v_ref is null then
      raise exception 'product not found';
    end if;
    if v_ref is distinct from v_company then
      raise exception 'product belongs to another company';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function enforce_config_option_tenant() from public, anon, authenticated;

drop trigger if exists trg_config_options_tenant on product_config_options;
create trigger trg_config_options_tenant
  before insert or update of step_id, ingredient_id, product_id on product_config_options
  for each row execute function enforce_config_option_tenant();

-- mesma company entre step e product (steps.product_id × steps.company_id)
create or replace function enforce_config_step_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  if new.product_id is distinct from old.product_id or TG_OP = 'INSERT' then
    select company_id into v_company from public.products where id = new.product_id;
    if v_company is null then
      raise exception 'product not found';
    end if;
    if v_company is distinct from new.company_id then
      raise exception 'product belongs to another company';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function enforce_config_step_tenant() from public, anon, authenticated;

drop trigger if exists trg_config_steps_tenant on product_config_steps;
create trigger trg_config_steps_tenant
  before insert or update of product_id, company_id on product_config_steps
  for each row execute function enforce_config_step_tenant();

-- RLS indireta via step.company_id (leitura membro; escrita por papel via step)
drop policy if exists config_options_select_member on product_config_options;
create policy config_options_select_member on product_config_options
  for select to authenticated
  using (
    exists (select 1 from product_config_steps s
      where s.id = step_id and (is_company_member(s.company_id) or is_platform_admin()))
  );

drop policy if exists config_options_insert_mgr on product_config_options;
create policy config_options_insert_mgr on product_config_options
  for insert to authenticated
  with check (
    exists (select 1 from product_config_steps s
      where s.id = step_id
        and ((is_company_member(s.company_id) and member_role(s.company_id) in ('OWNER','ADMIN','MANAGER'))
          or is_platform_admin()))
  );

drop policy if exists config_options_update_mgr on product_config_options;
create policy config_options_update_mgr on product_config_options
  for update to authenticated
  using (
    exists (select 1 from product_config_steps s
      where s.id = step_id
        and ((is_company_member(s.company_id) and member_role(s.company_id) in ('OWNER','ADMIN','MANAGER'))
          or is_platform_admin()))
  )
  with check (
    exists (select 1 from product_config_steps s
      where s.id = step_id
        and ((is_company_member(s.company_id) and member_role(s.company_id) in ('OWNER','ADMIN','MANAGER'))
          or is_platform_admin()))
  );

drop policy if exists config_options_delete_mgr on product_config_options;
create policy config_options_delete_mgr on product_config_options
  for delete to authenticated
  using (
    exists (select 1 from product_config_steps s
      where s.id = step_id
        and ((is_company_member(s.company_id) and member_role(s.company_id) in ('OWNER','ADMIN','MANAGER'))
          or is_platform_admin()))
  );
