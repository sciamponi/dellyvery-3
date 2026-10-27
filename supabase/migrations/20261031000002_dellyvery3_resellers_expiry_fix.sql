-- DELLVERY 3 — Revenda: expiração sem rollback (local only).
--
-- Correção da 20261031000000: marcar `expirado` com UPDATE seguido de
-- RAISE nunca persistia — o erro aborta a transação do chamador e
-- desfaz o UPDATE. Novo desenho:
--   1. resolve/claim apenas DETECTAM expiração/revogação e negam
--      (sem escrever nada antes do erro);
--   2. `sweep_expired_reseller_invites()` (admin) faz a marcação em
--      transação própria e é chamada pelo Painel Master ao carregar.
-- Sem drift de schema; mesma semântica de negação para o público.

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

-- =========================
-- Varredura de expirados (admin): marcação em transação própria.
-- Chamada pelo Painel Master ao carregar a área Revenda.
-- =========================
create or replace function sweep_expired_reseller_invites()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n bigint := 0;
begin
  if not public.is_platform_admin() then
    raise exception 'Sem permissão';
  end if;
  update public.reseller_invites
  set status = 'expirado', updated_at = now(),
      events = events || jsonb_build_array(jsonb_build_object(
        'at', now(), 'action', 'expirado'
      ))
  where status in ('criado', 'enviado') and expires_at < now();
  get diagnostics v_n = row_count;
  return jsonb_build_object('swept', v_n);
end;
$$;

revoke all on function sweep_expired_reseller_invites() from public, anon;
grant execute on function sweep_expired_reseller_invites() to authenticated;
