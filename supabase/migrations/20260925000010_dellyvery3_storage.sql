-- DELLVERY 3 — Storage buckets + policies (FASE 5.5-B2, local only)
-- Migration incremental: apenas storage. Nenhuma policy de tabela tocada.
-- Estrutura aprovada:
--   avatars/ -> user_id/ (profiles.avatar_url; ownership pelo próprio usuário)
--   logos/   -> company_id/ (companies.logo_url)
--   catalog/ -> company_id/ (products/categories image_url)
-- Leitura pública (vitrine); escrita só autenticada e escopada.
-- Limite de bucket 8 MB (app valida 5 MB; fora da UI não passa de 8 MB).
-- MIME: jpeg/png/webp.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 8388608, array['image/jpeg', 'image/png', 'image/webp']),
  ('logos', 'logos', true, 8388608, array['image/jpeg', 'image/png', 'image/webp']),
  ('catalog', 'catalog', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- =========================
-- Leitura pública (somente SELECT)
-- =========================
drop policy if exists "Public read avatars" on storage.objects;
create policy "Public read avatars" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'avatars');

drop policy if exists "Public read logos" on storage.objects;
create policy "Public read logos" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'logos');

drop policy if exists "Public read catalog" on storage.objects;
create policy "Public read catalog" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'catalog');

-- =========================
-- Escrita avatars: só o dono (pasta = auth.uid())
-- =========================
drop policy if exists "Owner write avatars" on storage.objects;
create policy "Owner write avatars" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Owner update avatars" on storage.objects;
create policy "Owner update avatars" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Owner delete avatars" on storage.objects;
create policy "Owner delete avatars" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- =========================
-- Escrita logos/catalog: membro ativo da empresa da pasta.
-- (O salvamento da URL nas tabelas segue o RLS das tabelas, que exige
-- papéis; upload sozinho não concede acesso a dados.)
-- =========================
drop policy if exists "Member write logos" on storage.objects;
create policy "Member write logos" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'logos'
    and exists (
      select 1 from public.company_members
      where company_id = ((storage.foldername(name))[1])::uuid
        and user_id = auth.uid()
        and active = true
    )
  );

drop policy if exists "Member update logos" on storage.objects;
create policy "Member update logos" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'logos'
    and exists (
      select 1 from public.company_members
      where company_id = ((storage.foldername(name))[1])::uuid
        and user_id = auth.uid()
        and active = true
    )
  )
  with check (
    bucket_id = 'logos'
    and exists (
      select 1 from public.company_members
      where company_id = ((storage.foldername(name))[1])::uuid
        and user_id = auth.uid()
        and active = true
    )
  );

drop policy if exists "Member delete logos" on storage.objects;
create policy "Member delete logos" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'logos'
    and exists (
      select 1 from public.company_members
      where company_id = ((storage.foldername(name))[1])::uuid
        and user_id = auth.uid()
        and active = true
    )
  );

drop policy if exists "Member write catalog" on storage.objects;
create policy "Member write catalog" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'catalog'
    and exists (
      select 1 from public.company_members
      where company_id = ((storage.foldername(name))[1])::uuid
        and user_id = auth.uid()
        and active = true
    )
  );

drop policy if exists "Member update catalog" on storage.objects;
create policy "Member update catalog" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'catalog'
    and exists (
      select 1 from public.company_members
      where company_id = ((storage.foldername(name))[1])::uuid
        and user_id = auth.uid()
        and active = true
    )
  )
  with check (
    bucket_id = 'catalog'
    and exists (
      select 1 from public.company_members
      where company_id = ((storage.foldername(name))[1])::uuid
        and user_id = auth.uid()
        and active = true
    )
  );

drop policy if exists "Member delete catalog" on storage.objects;
create policy "Member delete catalog" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'catalog'
    and exists (
      select 1 from public.company_members
      where company_id = ((storage.foldername(name))[1])::uuid
        and user_id = auth.uid()
        and active = true
    )
  );
