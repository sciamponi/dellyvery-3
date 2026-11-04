-- DELLVERY 3 - Duracao de acesso do plano para ativacoes de revenda.
--
-- A duracao e comercial, configurada pelo Master por plano. Planos antigos
-- permanecem com NULL de proposito: a ativacao v2 recusa plano sem duracao,
-- evitando datas livres ou valores inventados pelo frontend.

alter table public.plans
  add column if not exists access_days integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'plans_access_days_check'
      and conrelid = 'public.plans'::regclass
  ) then
    alter table public.plans
      add constraint plans_access_days_check
      check (access_days is null or access_days > 0);
  end if;
end $$;

notify pgrst, 'reload schema';
