-- DELLVERY 3 — Fase C: amarração de driver_notifications (base oficial PROJ).
-- NÃO aplicada em produção/staging nesta execução (proposta local).
--
-- A policy driver_notif_write_team valida o membro na empresa informada,
-- mas não amarra order_id/driver_id a ela: um membro de A poderia registrar
-- notificação de pedido de B sob company_id=A. Este trigger (DEFINER,
-- enxerga todas as linhas independente de RLS) exige a mesma empresa nas
-- três pontas. Fluxos legítimos (PDV/OrderModal com ids da empresa) passam.

create or replace function enforce_driver_notif_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_cid uuid;
  v_drv_cid uuid;
begin
  select company_id into v_order_cid from public.orders where id = new.order_id;
  if not found or v_order_cid is null then
    raise exception 'Pedido não encontrado';
  end if;
  if v_order_cid is distinct from new.company_id then
    raise exception 'Notificação pertence a outra empresa';
  end if;
  if new.driver_id is not null then
    select company_id into v_drv_cid from public.delivery_drivers where id = new.driver_id;
    if not found then
      raise exception 'Entregador não encontrado';
    end if;
    if v_drv_cid is distinct from new.company_id then
      raise exception 'Entregador pertence a outra empresa';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function enforce_driver_notif_refs() from public, anon, authenticated;

drop trigger if exists trg_driver_notif_refs on public.driver_notifications;
create trigger trg_driver_notif_refs
  before insert or update on public.driver_notifications
  for each row execute function enforce_driver_notif_refs();
