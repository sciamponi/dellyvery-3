-- DELLVERY 3 — Cadastro de interessados (local only)
-- Tabela leads + RPC pública create_lead + RPC admin set_lead_status.
-- Anon: sem acesso direto (só via RPC DEFINER). Membros: sem acesso
-- (lead é pré-empresa). PLATFORM_ADMIN: total.

do $$ begin
  create type lead_status as enum (
    'novo', 'em_contato', 'aguardando_dados',
    'proposta_enviada', 'contratado', 'descartado'
  );
exception when duplicate_object then null; end $$;

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  service text not null,
  service_other text,
  person_type text not null default 'pj',
  company_name text,
  trade_name text,
  cnpj text,
  state_registration text,
  full_name text not null,
  cpf text,
  role text,
  phone text not null,
  email text not null,
  address jsonb not null default '{}'::jsonb,
  notes text,
  plan_interest text,
  consent_at timestamptz,
  status lead_status not null default 'novo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_lead_service_not_empty check (btrim(service) <> ''),
  constraint chk_lead_name_not_empty check (btrim(full_name) <> ''),
  constraint chk_lead_email_format check (btrim(email) <> '' and email like '%@%.%')
);

create index if not exists idx_leads_status_created on leads (status, created_at desc);
create index if not exists idx_leads_service on leads (service);
create index if not exists idx_leads_email on leads (email);

drop trigger if exists trg_leads_updated_at on leads;
create trigger trg_leads_updated_at
  before update on leads
  for each row execute function set_updated_at();

alter table leads enable row level security;

-- Anon e membros: sem acesso direto. Admin: total.
drop policy if exists leads_no_anon on leads;
create policy leads_no_anon on leads
  for all to anon
  using (false)
  with check (false);

drop policy if exists leads_admin_all on leads;
create policy leads_admin_all on leads
  for all to authenticated
  using (is_platform_admin())
  with check (is_platform_admin());

-- =========================
-- RPC pública: create_lead
-- =========================
create or replace function create_lead(p_lead jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service text := btrim(coalesce(p_lead ->> 'service', ''));
  v_service_other text := nullif(btrim(coalesce(p_lead ->> 'service_other', '')), '');
  v_person_type text := coalesce(nullif(btrim(coalesce(p_lead ->> 'person_type', '')), ''), 'pj');
  v_company_name text := nullif(btrim(coalesce(p_lead ->> 'company_name', '')), '');
  v_trade_name text := nullif(btrim(coalesce(p_lead ->> 'trade_name', '')), '');
  v_cnpj text := nullif(regexp_replace(coalesce(p_lead ->> 'cnpj', ''), '\D', '', 'g'), '');
  v_state_registration text := nullif(btrim(coalesce(p_lead ->> 'state_registration', '')), '');
  v_full_name text := btrim(coalesce(p_lead ->> 'full_name', ''));
  v_cpf text := nullif(regexp_replace(coalesce(p_lead ->> 'cpf', ''), '\D', '', 'g'), '');
  v_role text := nullif(btrim(coalesce(p_lead ->> 'role', '')), '');
  v_phone text := nullif(regexp_replace(coalesce(p_lead ->> 'phone', ''), '\D', '', 'g'), '');
  v_email text := btrim(coalesce(p_lead ->> 'email', ''));
  v_address jsonb := coalesce(p_lead -> 'address', '{}'::jsonb);
  v_notes text := nullif(btrim(coalesce(p_lead ->> 'notes', '')), '');
  v_plan_interest text := nullif(btrim(coalesce(p_lead ->> 'plan_interest', '')), '');
  v_consent boolean := coalesce((p_lead ->> 'consent')::boolean, false);
  v_id uuid;
begin
  if v_service = '' then
    raise exception 'Serviço desejado é obrigatório';
  end if;
  if v_person_type not in ('pj', 'pf') then
    raise exception 'Tipo de cadastro inválido';
  end if;
  if v_full_name = '' then
    raise exception 'Nome do responsável é obrigatório';
  end if;
  if v_phone is null or char_length(v_phone) not in (10, 11) then
    raise exception 'Telefone/WhatsApp inválido';
  end if;
  if v_email = '' or v_email not like '%@%.%' then
    raise exception 'E-mail inválido';
  end if;
  if v_person_type = 'pj' and v_cnpj is null then
    raise exception 'CNPJ é obrigatório para pessoa jurídica';
  end if;
  if v_cnpj is not null and char_length(v_cnpj) <> 14 then
    raise exception 'CNPJ inválido';
  end if;
  if v_cpf is not null and char_length(v_cpf) <> 11 then
    raise exception 'CPF inválido';
  end if;
  if not v_consent then
    raise exception 'É necessário aceitar o uso dos dados para contato';
  end if;

  insert into public.leads (
    service, service_other, person_type, company_name, trade_name, cnpj,
    state_registration, full_name, cpf, role, phone, email, address,
    notes, plan_interest, consent_at, status
  ) values (
    v_service, v_service_other, v_person_type, v_company_name, v_trade_name, v_cnpj,
    v_state_registration, v_full_name, v_cpf, v_role, v_phone, v_email, v_address,
    v_notes, v_plan_interest, now(), 'novo'
  ) returning id into v_id;

  return jsonb_build_object('lead_id', v_id);
end;
$$;

revoke all on function create_lead(jsonb) from public;
grant execute on function create_lead(jsonb) to anon, authenticated;

-- =========================
-- RPC admin: set_lead_status
-- =========================
create or replace function set_lead_status(p_lead_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_new lead_status;
  v_count int;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_platform_admin() then
    raise exception 'Acesso restrito à administração';
  end if;
  if p_status is null
     or not (p_status = any (array['novo','em_contato','aguardando_dados','proposta_enviada','contratado','descartado'])) then
    raise exception 'Status inválido';
  end if;
  v_new := p_status::public.lead_status;
  update public.leads set status = v_new, updated_at = now()
  where id = p_lead_id;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Cadastro não encontrado';
  end if;
  return (select to_jsonb(l) from public.leads l where l.id = p_lead_id);
end;
$$;

revoke all on function set_lead_status(uuid, text) from public;
revoke all on function set_lead_status(uuid, text) from anon;
grant execute on function set_lead_status(uuid, text) to authenticated;
