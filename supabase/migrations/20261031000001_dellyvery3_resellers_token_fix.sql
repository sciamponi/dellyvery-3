-- DELLVERY 3 — Revenda: token sem pgcrypto (local only).
--
-- Correção da 20261031000000: `gen_random_bytes()` exige a extensão
-- pgcrypto, indisponível neste banco. Troca por
-- `replace(gen_random_uuid()::text, '-', '')` (32 hex, mesmo formato
-- `^[0-9a-f]{32}$`), seguindo o padrão da 20261016000000
-- (dining_tables.public_token). Sem extensão nova, sem drift de schema.

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

  v_token := replace(gen_random_uuid()::text, '-', '');
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
