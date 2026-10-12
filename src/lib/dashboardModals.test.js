import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDashboardModal, isNovosAlertCard, filterNovosOrders } from './dashboardModals.js';

const parts = {
  delayed: [{ id: 'd1' }],
  novos: [{ id: 'n1' }, { id: 'n2' }],
  ordersToday: [{ id: 'h1' }],
  inProgress: [{ id: 'a1' }],
  finished: [{ id: 'f1' }],
  canceled: [{ id: 'c1' }],
  finDeliveryFiltered: [{ id: 'e1' }],
  finRetirada: [{ id: 'r1' }],
  finMesa: [{ id: 'm1' }],
  inQueue: [{ id: 'q1' }],
};

describe('dashboardModals — kind do modal', () => {
  it('novos abre a fila filtrada com o título correto', () => {
    const m = getDashboardModal('novos', parts);
    assert.equal(m.title, 'Novos pedidos aguardando');
    assert.deepEqual(m.orders, parts.novos);
  });

  it('demais kinds preservados (paridade com o Dashboard)', () => {
    assert.deepEqual(getDashboardModal('atraso', parts), { title: 'Pedidos em atraso', orders: parts.delayed });
    assert.deepEqual(getDashboardModal('hoje', parts), { title: 'Pedidos de hoje', orders: parts.ordersToday });
    assert.deepEqual(getDashboardModal('andamento', parts), { title: 'Em andamento', orders: parts.inProgress });
    assert.deepEqual(getDashboardModal('finalizados', parts), { title: 'Finalizados', orders: parts.finished });
    assert.deepEqual(getDashboardModal('cancelados', parts), { title: 'Cancelados', orders: parts.canceled });
    assert.deepEqual(getDashboardModal('finDelivery', parts), { title: 'Entregas finalizadas', orders: parts.finDeliveryFiltered });
    assert.deepEqual(getDashboardModal('finRetirada', parts), { title: 'Retiradas finalizadas', orders: parts.finRetirada });
    assert.deepEqual(getDashboardModal('finMesa', parts), { title: 'Mesas finalizadas', orders: parts.finMesa });
    assert.deepEqual(getDashboardModal('fila', parts), { title: 'Pedidos na fila', orders: parts.inQueue });
    assert.deepEqual(getDashboardModal(null, parts), { title: 'Pedidos na fila', orders: parts.inQueue });
  });

  it('tolerante a partes ausentes', () => {
    assert.deepEqual(getDashboardModal('novos', null), { title: 'Novos pedidos aguardando', orders: [] });
    assert.deepEqual(getDashboardModal('hoje', {}), { title: 'Pedidos de hoje', orders: [] });
  });
});

describe('dashboardModals — alerta e filtro de novos', () => {
  it('alerta só no card Novos pedidos com novo aguardando', () => {
    assert.equal(isNovosAlertCard(true, 'Novos pedidos'), true);
    assert.equal(isNovosAlertCard(true, 'Pedidos hoje'), false);
    assert.equal(isNovosAlertCard(true, 'Na fila'), false);
    assert.equal(isNovosAlertCard(false, 'Novos pedidos'), false);
  });

  it('filtro conta todos os novo sem alterar nada', () => {
    const orders = [
      { id: 'a', status: 'novo' },
      { id: 'b', status: 'confirmado' },
      { id: 'c', status: 'novo' },
      { id: 'd', status: 'finalizado' },
    ];
    const out = filterNovosOrders(orders);
    assert.deepEqual(out.map(o => o.id), ['a', 'c']);
    assert.equal(orders.length, 4);
    assert.deepEqual(filterNovosOrders(null), []);
  });
});
