-- DELLVERY 3 — QR Code Pix no storage global do Master.
-- Bucket publico para leitura (a imagem e instrucao de pagamento), escrita
-- exclusiva de PLATFORM_ADMIN. A RPC continua sendo a unica via para alterar
-- a configuracao global.

alter table public.platform_pix_settings
  add column if not exists qr_image_path text;

alter table public.platform_pix_settings
  drop constraint if exists platform_pix_settings_qr_image_path_check;

alter table public.platform_pix_settings
  add constraint platform_pix_settings_qr_image_path_check
  check (
    qr_image_path is null
    or (qr_image_path like 'pix-qr/%' and char_length(qr_image_path) <= 500)
  );

create or replace function public.platform_asset_path_from_url(p_url text)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select (
    regexp_match(
      coalesce(p_url, ''),
      '^https?://[^/]+/storage/v1/object/public/platform-assets/(.+)$'
    )
  )[1];
$$;

revoke all on function public.platform_asset_path_from_url(text)
  from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'platform-assets',
  'platform-assets',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read platform assets" on storage.objects;
create policy "Public read platform assets" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'platform-assets');

drop policy if exists "Platform admin write platform assets" on storage.objects;
create policy "Platform admin write platform assets" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'platform-assets'
    and (storage.foldername(name))[1] = 'pix-qr'
    and public.is_platform_admin()
  );

drop policy if exists "Platform admin update platform assets" on storage.objects;
create policy "Platform admin update platform assets" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'platform-assets'
    and (storage.foldername(name))[1] = 'pix-qr'
    and public.is_platform_admin()
  )
  with check (
    bucket_id = 'platform-assets'
    and (storage.foldername(name))[1] = 'pix-qr'
    and public.is_platform_admin()
  );

drop policy if exists "Platform admin delete platform assets" on storage.objects;
create policy "Platform admin delete platform assets" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'platform-assets'
    and (storage.foldername(name))[1] = 'pix-qr'
    and public.is_platform_admin()
  );

create or replace function public.get_platform_pix_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.platform_pix_settings%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Sem permissao';
  end if;

  select * into v_row
  from public.platform_pix_settings
  where id = true;

  if not found then
    return jsonb_build_object(
      'active', false,
      'pix_key_type', null,
      'pix_key', null,
      'receiver_name', null,
      'qr_image_url', null,
      'qr_image_path', null,
      'qr_payload', null,
      'instructions', null,
      'version', null,
      'updated_at', null,
      'updated_by', null
    );
  end if;

  return jsonb_build_object(
    'active', v_row.active,
    'pix_key_type', v_row.pix_key_type,
    'pix_key', v_row.pix_key,
    'receiver_name', v_row.receiver_name,
    'qr_image_url', v_row.qr_image_url,
    'qr_image_path', v_row.qr_image_path,
    'qr_payload', v_row.qr_payload,
    'instructions', v_row.instructions,
    'version', v_row.version,
    'updated_at', v_row.updated_at,
    'updated_by', v_row.updated_by
  );
end;
$$;

create or replace function public.set_platform_pix_settings(
  p_active boolean default false,
  p_pix_key_type text default null,
  p_pix_key text default null,
  p_receiver_name text default null,
  p_qr_image_url text default null,
  p_qr_payload text default null,
  p_instructions text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_old_version integer := 0;
  v_new_version integer;
  v_active boolean := coalesce(p_active, false);
  v_key_type text := nullif(btrim(p_pix_key_type), '');
  v_key text := nullif(btrim(p_pix_key), '');
  v_receiver text := nullif(btrim(p_receiver_name), '');
  v_qr_url text := nullif(btrim(p_qr_image_url), '');
  v_qr_path text;
  v_qr_payload text := nullif(btrim(p_qr_payload), '');
  v_instructions text := nullif(btrim(p_instructions), '');
  v_old_qr_path text;
  v_row public.platform_pix_settings%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Sem permissao';
  end if;

  if v_key_type is not null and v_key_type not in ('cpf', 'cnpj', 'email', 'phone', 'random') then
    raise exception 'Tipo de chave Pix invalido';
  end if;

  if v_active and v_key is null then
    raise exception 'Informe a chave Pix para ativar as instrucoes';
  end if;

  if v_key is not null and char_length(v_key) > 500 then
    raise exception 'Chave Pix muito longa';
  end if;

  if v_receiver is not null and char_length(v_receiver) > 200 then
    raise exception 'Nome do recebedor muito longo';
  end if;

  if v_qr_url is not null and char_length(v_qr_url) > 1000 then
    raise exception 'URL do QR Code muito longa';
  end if;

  v_qr_path := public.platform_asset_path_from_url(v_qr_url);

  if v_qr_url is not null and v_qr_path is null then
    raise exception 'QR Code deve ser enviado pelo armazenamento do sistema';
  end if;

  if v_qr_path is not null
     and (v_qr_path not like 'pix-qr/%' or v_qr_path like '%..%') then
    raise exception 'Caminho do QR Code invalido';
  end if;

  if v_qr_payload is not null and char_length(v_qr_payload) > 4000 then
    raise exception 'Payload do QR Code muito longo';
  end if;

  if v_instructions is not null and char_length(v_instructions) > 2000 then
    raise exception 'Instrucoes muito longas';
  end if;

  insert into public.platform_pix_settings (id)
  values (true)
  on conflict (id) do nothing;

  select version, qr_image_path
  into v_old_version, v_old_qr_path
  from public.platform_pix_settings
  where id = true
  for update;

  v_new_version := coalesce(v_old_version, 0) + 1;

  update public.platform_pix_settings
  set active = v_active,
      pix_key_type = v_key_type,
      pix_key = v_key,
      receiver_name = v_receiver,
      qr_image_url = v_qr_url,
      qr_image_path = v_qr_path,
      qr_payload = v_qr_payload,
      instructions = v_instructions,
      version = v_new_version,
      updated_at = now(),
      updated_by = auth.uid()
  where id = true
  returning * into v_row;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  ) values (
    null, auth.uid(), 'platform_pix_settings_updated', 'platform_pix_settings', null,
    jsonb_build_object(
      'old_version', v_old_version,
      'new_version', v_new_version,
      'active', v_row.active,
      'pix_key_type', v_row.pix_key_type,
      'has_pix_key', v_row.pix_key is not null,
      'has_qr_image_url', v_row.qr_image_url is not null,
      'has_qr_image_path', v_row.qr_image_path is not null,
      'qr_image_replaced', v_old_qr_path is distinct from v_row.qr_image_path,
      'has_qr_payload', v_row.qr_payload is not null,
      'has_instructions', v_row.instructions is not null
    )
  );

  return jsonb_build_object(
    'active', v_row.active,
    'pix_key_type', v_row.pix_key_type,
    'pix_key', v_row.pix_key,
    'receiver_name', v_row.receiver_name,
    'qr_image_url', v_row.qr_image_url,
    'qr_image_path', v_row.qr_image_path,
    'qr_payload', v_row.qr_payload,
    'instructions', v_row.instructions,
    'version', v_row.version,
    'updated_at', v_row.updated_at,
    'updated_by', v_row.updated_by,
    'previous_qr_image_path', v_old_qr_path
  );
end;
$$;

revoke all on function public.get_platform_pix_settings() from public, anon;
grant execute on function public.get_platform_pix_settings() to authenticated, service_role;

revoke all on function public.set_platform_pix_settings(boolean,text,text,text,text,text,text) from public, anon;
grant execute on function public.set_platform_pix_settings(boolean,text,text,text,text,text,text) to authenticated, service_role;

notify pgrst, 'reload schema';
