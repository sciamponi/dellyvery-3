-- DELLVERY 3 — Realtime publication (FASE 5.4 ETAPA B7, local only)
-- A publication supabase_realtime estava VAZIA (verificado localmente);
-- realtime=true no config não basta. Adiciona as tabelas do painel.
-- Replica identity FULL para UPDATE/DELETE entregarem a linha no payload.
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table order_items;
alter publication supabase_realtime add table order_status_history;
alter publication supabase_realtime add table notifications;

alter table orders replica identity full;
alter table order_items replica identity full;
alter table order_status_history replica identity full;
alter table notifications replica identity full;
