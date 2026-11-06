-- Fixa o search_path de helpers SECURITY DEFINER usados por RLS.
--
-- Problema comprovado: com `set search_path = public`, o schema temporario
-- (pg_temp) e pesquisado antes de public para nomes de relacao. Uma sessao
-- capaz de criar tabela temporaria podia fazer `is_platform_admin()` ler
-- pg_temp.profiles e retornar true, e `member_role()` ler
-- pg_temp.company_members e devolver um papel arbitrario.
--
-- Correcao: qualifica os nomes com o schema public e lista pg_temp por
-- ultimo no search_path. Nao altera ownership nem grants existentes.

create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and platform_role = 'PLATFORM_ADMIN'
  );
$$;

create or replace function public.member_role(p_company_id uuid)
returns public.company_role
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select role
  from public.company_members
  where company_id = p_company_id
    and user_id = auth.uid()
    and active = true
  limit 1;
$$;

-- Fail-closed: as funcoes continuam sem EXECUTE para PUBLIC.
do $$
begin
  if has_function_privilege('public', 'public.is_platform_admin()', 'EXECUTE') then
    raise exception 'is_platform_admin ainda executavel por PUBLIC';
  end if;
  if has_function_privilege('public', 'public.member_role(uuid)', 'EXECUTE') then
    raise exception 'member_role ainda executavel por PUBLIC';
  end if;
end;
$$;
