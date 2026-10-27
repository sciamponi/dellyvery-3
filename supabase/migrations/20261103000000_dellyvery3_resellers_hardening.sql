-- DELLVERY 3 — Revenda: endurecimento do pré-cadastro (local only).
--
-- Corrige três riscos da fase de convites:
-- 1. corrida de convites ativos duplicados por telefone (índice único
--    parcial + tratamento de unique_violation na RPC de criação);
-- 2. transições de status validadas apenas no frontend (trigger no banco);
-- 3. abuso das RPCs públicas resolve/claim (limite por IP/hora, fail-open
--    quando o cabeçalho de IP não está disponível).
--
-- Aplicar depois de 20261031000002 (expiry_fix). Não cria permissões de
-- revendedor, carteira ou créditos: o escopo continua sendo pré-cadastro.

-- =========================
-- Rate limit das RPCs públicas (tabela interna, sem acesso direto).
-- =========================
create table if not exists public.reseller_rpc_rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

create index if not exists idx_reseller_rpc_rate_limits_window
  on public.reseller_rpc_rate_limits (window_start);

alter table public.reseller_rpc_rate_limits enable row level security;
revoke all on table public.reseller_rpc_rate_limits from public, anon, authenticated;

create or replace function public.consume_reseller_rpc_limit(p_action text, p_limit integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip text;
  v_bucket text;
  v_window timestamptz := date_trunc('hour', now());
  v_hits integer;
begin
  if p_action is null or p_action not in ('resolve', 'claim')
     or p_limit is null or p_limit < 1 then
    raise exception 'Limite inválido';
  end if;

  -- Mesmo padrão da 20261029000000 (leads): primeiro IP do x-forwarded-for.
  -- Sem cabeçalho confiável, o limite é ignorado (fail-open).
  begin
    v_ip := nullif(btrim(split_part(
      coalesce((current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for'), ''), ',', 1)), '');
  exception when others then
    v_ip := null;
  end;
  if v_ip is null then
    return;
  end if;

  v_bucket := p_action || ':' || v_ip;
  insert into public.reseller_rpc_rate_limits (bucket, window_start, hits)
  values (v_bucket, v_window, 1)
  on conflict (bucket, window_start)
  do update set hits = public.reseller_rpc_rate_limits.hits + 1
  returning hits into v_hits;

  if v_hits > p_limit then
    raise exception 'Muitas tentativas. Tente novamente mais tarde.';
  end if;

  delete from public.reseller_rpc_rate_limits
  where window_start < now() - interval '2 days';
end;
$$;

revoke all on function public.consume_reseller_rpc_limit(text, integer)
  from public, anon, authenticated;

-- =========================
-- Um único convite ativo por telefone (inclui inscrição e aprovação).
-- =========================
create unique index if not exists uq_reseller_invites_active_phone
  on public.reseller_invites (phone)
  where status in ('criado', 'enviado', 'aguardando_aprovacao', 'aprovado', 'suspenso');

-- =========================
-- Transições de status no banco (não apenas no frontend).
-- =========================
create or replace function public.enforce_reseller_invite_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if not (
    (old.status = 'criado' and new.status in ('enviado', 'aguardando_aprovacao', 'revogado', 'expirado'))
    or (old.status = 'enviado' and new.status in ('aguardando_aprovacao', 'revogado', 'expirado'))
    or (old.status = 'aguardando_aprovacao' and new.status in ('aprovado', 'recusado'))
    or (old.status = 'aprovado' and new.status = 'suspenso')
    or (old.status = 'suspenso' and new.status = 'aprovado')
  ) then
    raise exception 'Transição de convite inválida: % → %', old.status, new.status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reseller_invite_transition on public.reseller_invites;
create trigger trg_reseller_invite_transition
before update of status on public.reseller_invites
for each row execute function public.enforce_reseller_invite_transition();

-- =========================
-- Criação de convite: reutiliza qualquer registro ativo do telefone e
-- resolve a corrida do índice único retornando o registro vencedor.
-- =========================
create or replace function public.create_reseller_invite(p_name text, p_phone text)
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
  if v_phone is null or v_phone = ''
     or not (v_phone ~ '^55[0-9]{10,11}$') then
    raise exception 'WhatsApp inválido (use DDI+DDD+número, ex.: 5511999999999)';
  end if;

  select * into v_existing from public.reseller_invites
  where phone = v_phone
    and status in ('criado', 'enviado', 'aguardando_aprovacao', 'aprovado', 'suspenso')
  order by created_at desc limit 1;
  if found then
    return jsonb_build_object(
      'invite_id', v_existing.id, 'token', v_existing.token,
      'status', v_existing.status, 'reused', true
    );
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '');
  begin
    insert into public.reseller_invites
      (token, name, phone, created_by, events)
    values (
      v_token, v_name, v_phone, auth.uid(),
      jsonb_build_array(jsonb_build_object(
        'at', now(), 'by', auth.uid(), 'action', 'criado'
      ))
    ) returning id into v_id;
  exception when unique_violation then
    -- Corrida: outra chamada criou o mesmo telefone entre o SELECT e o INSERT.
    select * into v_existing from public.reseller_invites
    where phone = v_phone
      and status in ('criado', 'enviado', 'aguardando_aprovacao', 'aprovado', 'suspenso')
    order by created_at desc limit 1;
    if found then
      return jsonb_build_object(
        'invite_id', v_existing.id, 'token', v_existing.token,
        'status', v_existing.status, 'reused', true
      );
    end if;
    raise;
  end;

  return jsonb_build_object(
    'invite_id', v_id, 'token', v_token,
    'status', 'criado', 'reused', false
  );
end;
$$;

revoke all on function public.create_reseller_invite(text, text) from public, anon;
grant execute on function public.create_reseller_invite(text, text) to authenticated;

-- =========================
-- Resolução pública: rate limit + mesmas regras da expiry_fix.
-- =========================
create or replace function public.resolve_reseller_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := nullif(btrim(coalesce(p_token, '')), '');
  v_row record;
begin
  perform public.consume_reseller_rpc_limit('resolve', 120);

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

revoke all on function public.resolve_reseller_invite(text) from public;
grant execute on function public.resolve_reseller_invite(text) to anon, authenticated;

-- =========================
-- Inscrição pública: rate limit + mesmas regras da expiry_fix.
-- =========================
create or replace function public.claim_reseller_invite(p_token text, p_data jsonb)
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
  perform public.consume_reseller_rpc_limit('claim', 30);

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

revoke all on function public.claim_reseller_invite(text, jsonb) from public;
grant execute on function public.claim_reseller_invite(text, jsonb) to anon, authenticated;
