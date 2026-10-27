-- DELLVERY 3 — Módulo Revenda: convites de parceiros (local only).
--
-- NÃO aplicada em produção/staging nesta execução (arquivo local para
-- desenvolvimento). Aplicar somente em ambiente de desenvolvimento.
--
-- 1. reseller_invites: convite individual com token aleatório (32 hex),
--    sem IDs sequenciais nem dados pessoais como autorização. Inscrição
--    (pré-cadastro) fica em `registration` (jsonb) no próprio convite:
--    convite, inscrição e aprovação consistentes em uma linha, sem
--    duplicar estruturas (leads/adhesions não são tocados).
-- 2. Ciclo de vida: criado → enviado → aguardando_aprovacao →
--    aprovado|recusado; aprovado → suspenso → aprovado;
--    criado|enviado → revogado; criado|enviado expirados → expirado.
--    "Enviado" significa WhatsApp aberto com mensagem pronta (entrega
--    NÃO confirmada pelo sistema). Recusa preserva o histórico.
-- 3. RLS: anon bloqueado (política using(false)); PLATFORM_ADMIN total.
--    Público (anon) SOMENTE via RPCs SECURITY DEFINER abaixo.
-- 4. create_reseller_invite (admin): valida nome/telefone, reutiliza
--    convite ativo do mesmo telefone (sem duplicar links).
-- 5. resolve_reseller_invite (pública): valida token, expiração e
--    revogação; retorna SOMENTE pré-preenchimento (nome, telefone,
--    produto, modalidade, status). Nunca IDs internos além do necessário
--    ao claim (invite_id é uuid aleatório, não sequencial).
-- 6. claim_reseller_invite (pública, idempotente): reabertura do link
--    recupera o registro existente em vez de duplicar; telefone e
--    produto/modalidade travados no servidor (anti-tamper); sem
--    permissões de revendedor (só status aguardando_aprovacao).
-- Sem comissões, carteira ou hierarquia nesta fase (fora de escopo).

create table if not exists public.reseller_invites (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  name text not null,
  phone text not null,
  product text not null default 'dellyvery'
    check (product = 'dellyvery'),
  modality text not null default 'parceiro'
    check (modality = 'parceiro'),
  status text not null default 'criado'
    check (status in (
      'criado', 'enviado', 'aguardando_aprovacao', 'aprovado',
      'recusado', 'suspenso', 'expirado', 'revogado'
    )),
  registration jsonb not null default '{}'::jsonb,
  events jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  claimed_at timestamptz,
  decided_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  updated_at timestamptz not null default now()
);

create index if not exists idx_reseller_invites_status_created
  on public.reseller_invites (status, created_at desc);
create index if not exists idx_reseller_invites_phone
  on public.reseller_invites (phone);

alter table public.reseller_invites enable row level security;

drop policy if exists reseller_invites_no_anon on public.reseller_invites;
create policy reseller_invites_no_anon on public.reseller_invites
  for all to anon using (false) with check (false);

drop policy if exists reseller_invites_admin_all on public.reseller_invites;
create policy reseller_invites_admin_all on public.reseller_invites
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- =========================
-- Criação de convite (admin): gera token ou reutiliza ativo do telefone.
-- =========================
create or replace function create_reseller_invite(p_name text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_existing record;
  v_token text;
  v_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Sem permissão';
  end if;
  if v_name is null or char_length(v_name) < 2 then
    raise exception 'Nome do interessado é obrigatório';
  end if;
  -- WhatsApp com DDI (ex.: 55 + DDD + número = 12/13 dígitos).
  if v_phone is null or v_phone = ''
     or not (v_phone ~ '^55[0-9]{10,11}$') then
    raise exception 'WhatsApp inválido (use DDI+DDD+número, ex.: 5511999999999)';
  end if;

  -- Sem duplicar links: convite ativo do mesmo telefone é reutilizado.
  select * into v_existing from public.reseller_invites
  where phone = v_phone and status in ('criado', 'enviado')
  order by created_at desc limit 1;
  if found then
    return jsonb_build_object(
      'invite_id', v_existing.id, 'token', v_existing.token,
      'status', v_existing.status, 'reused', true
    );
  end if;

  v_token := encode(gen_random_bytes(16), 'hex');
  insert into public.reseller_invites
    (token, name, phone, created_by, events)
  values (
    v_token, v_name, v_phone, auth.uid(),
    jsonb_build_array(jsonb_build_object(
      'at', now(), 'by', auth.uid(), 'action', 'criado'
    ))
  ) returning id into v_id;

  return jsonb_build_object(
    'invite_id', v_id, 'token', v_token,
    'status', 'criado', 'reused', false
  );
end;
$$;

revoke all on function create_reseller_invite(text, text) from public, anon;
grant execute on function create_reseller_invite(text, text) to authenticated;

-- =========================
-- Resolução pública (anon): pré-preenchimento do pré-cadastro.
-- =========================
create or replace function resolve_reseller_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := nullif(btrim(coalesce(p_token, '')), '');
  v_row record;
begin
  if v_token is null or v_token !~ '^[0-9a-f]{32}$' then
    raise exception 'Convite não identificado';
  end if;
  select * into v_row from public.reseller_invites where token = v_token;
  if not found then
    raise exception 'Convite não encontrado';
  end if;
  if v_row.status = 'revogado' then
    raise exception 'Convite revogado. Fale com o administrador.';
  end if;
  if v_row.status in ('criado', 'enviado') and v_row.expires_at < now() then
    update public.reseller_invites
    set status = 'expirado', updated_at = now(),
        events = events || jsonb_build_array(jsonb_build_object(
          'at', now(), 'action', 'expirado'
        ))
    where id = v_row.id;
    raise exception 'Convite expirado. Solicite um novo convite.';
  end if;
  return jsonb_build_object(
    'invite_id', v_row.id,
    'name', v_row.name,
    'phone', v_row.phone,
    'product', v_row.product,
    'modality', v_row.modality,
    'status', v_row.status
  );
end;
$$;

revoke all on function resolve_reseller_invite(text) from public;
grant execute on function resolve_reseller_invite(text) to anon, authenticated;

-- =========================
-- Inscrição pública (anon, idempotente): reabertura recupera o
-- registro; telefone/produto/modalidade travados no servidor.
-- =========================
create or replace function claim_reseller_invite(p_token text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := nullif(btrim(coalesce(p_token, '')), '');
  v_row record;
  v_data jsonb := coalesce(p_data, '{}'::jsonb);
  v_name text := nullif(btrim(coalesce(v_data ->> 'full_name', '')), '');
  v_phone text := regexp_replace(coalesce(v_data ->> 'phone', ''), '\D', '', 'g');
  v_email text := nullif(btrim(coalesce(v_data ->> 'email', '')), '');
  v_reg jsonb;
begin
  if v_token is null or v_token !~ '^[0-9a-f]{32}$' then
    raise exception 'Convite não identificado';
  end if;
  select * into v_row from public.reseller_invites where token = v_token for update;
  if not found then
    raise exception 'Convite não encontrado';
  end if;
  if v_row.status = 'revogado' then
    raise exception 'Convite revogado. Fale com o administrador.';
  end if;
  if v_row.status in ('criado', 'enviado') and v_row.expires_at < now() then
    update public.reseller_invites
    set status = 'expirado', updated_at = now(),
        events = events || jsonb_build_array(jsonb_build_object(
          'at', now(), 'action', 'expirado'
        ))
    where id = v_row.id;
    raise exception 'Convite expirado. Solicite um novo convite.';
  end if;

  -- Idempotência: reabertura ou reenvio recupera o registro existente.
  if v_row.status in ('aguardando_aprovacao', 'aprovado', 'recusado', 'suspenso') then
    return jsonb_build_object('invite_id', v_row.id, 'status', v_row.status, 'reused', true);
  end if;

  if v_name is null then
    raise exception 'Nome completo é obrigatório';
  end if;
  -- Anti-tamper: telefone da inscrição deve ser o do convite.
  if v_phone is null or v_phone = '' or v_phone is distinct from v_row.phone then
    raise exception 'Telefone divergente do convite';
  end if;
  if v_email is not null and v_email not like '%@%.%' then
    raise exception 'E-mail inválido';
  end if;

  -- Sanitiza: só chaves conhecidas; produto/modalidade fixos no servidor.
  v_reg := jsonb_build_object(
    'full_name', v_name,
    'phone', v_row.phone,
    'email', v_email,
    'document', nullif(regexp_replace(coalesce(v_data ->> 'document', ''), '\D', '', 'g'), ''),
    'city', nullif(btrim(coalesce(v_data ->> 'city', '')), ''),
    'state', nullif(btrim(coalesce(v_data ->> 'state', '')), ''),
    'notes', nullif(btrim(coalesce(v_data ->> 'notes', '')), ''),
    'product', 'dellyvery',
    'modality', 'parceiro'
  );

  update public.reseller_invites
  set name = v_name,
      registration = v_reg,
      status = 'aguardando_aprovacao',
      claimed_at = now(),
      updated_at = now(),
      events = events || jsonb_build_array(jsonb_build_object(
        'at', now(), 'action', 'inscricao_enviada'
      ))
  where id = v_row.id;

  return jsonb_build_object(
    'invite_id', v_row.id, 'status', 'aguardando_aprovacao', 'reused', false
  );
end;
$$;

revoke all on function claim_reseller_invite(text, jsonb) from public;
grant execute on function claim_reseller_invite(text, jsonb) to anon, authenticated;
