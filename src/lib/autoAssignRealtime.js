import { getAutoAssignDriverId } from './autoAssign';
import { getCompanySettings } from '@/api/company';
import { listDrivers } from '@/api/team';
import { assignDriver } from '@/api/orders';

// Atribuição na chegada: chamado com o pedido novo vindo do realtime.
// - lê settings/drivers com cache curto (60s) por empresa;
// - idempotente: pedido já com driver ou terminal é ignorado;
// - falha silenciosa (nunca quebra o fluxo do painel).
// Retorna o driver_id atribuído ou null.

const CACHE_TTL_MS = 60000;

export function createAutoAssignRunner({ client, getCompanyId }) {
  let cache = null;

  async function load() {
    const cid = getCompanyId();
    const [s, d] = await Promise.all([
      getCompanySettings(client, cid).catch(() => null),
      listDrivers(client, cid).catch(() => []),
    ]);
    cache = { settings: s?.settings || {}, drivers: d || [], at: Date.now() };
    return cache;
  }

  return {
    async maybeAssign(order) {
      try {
        const cid = getCompanyId();
        if (!cid || !order || order.driver_id) return null;
        if (!cache || Date.now() - cache.at > CACHE_TTL_MS) await load();
        const id = getAutoAssignDriverId({ order, settings: cache.settings, drivers: cache.drivers });
        if (!id) return null;
        await assignDriver(client, order.id, cid, id);
        return id;
      } catch {
        return null;
      }
    },
  };
}
